#include "secrets.h"
#include <ETH.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_task_wdt.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <time.h>

// ==========================================
// Fallback Credentials (if missing from secrets.h)
// ==========================================
#ifndef WIFI_SSID
#define WIFI_SSID "TP-Link_1902"
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "40114583"
#endif

#ifndef FIREBASE_API_KEY
#define FIREBASE_API_KEY ""
#endif

#ifndef FIREBASE_AUTH_EMAIL
#define FIREBASE_AUTH_EMAIL ""
#endif

#ifndef FIREBASE_AUTH_PASSWORD
#define FIREBASE_AUTH_PASSWORD ""
#endif

// ==========================================
// Compile-Time Optimization Controls
// ==========================================
// Set to 1 to enable verbose debugging logs in Serial Monitor, or 0 for clean
// production operation
#define DEBUG_MODE 0

#if DEBUG_MODE
#define DEBUG_PRINT(x) Serial.print(x)
#define DEBUG_PRINTF(x, ...) Serial.printf(x, ##__VA_ARGS__)
#define DEBUG_PRINTLN(x) Serial.println(x)
#else
#define DEBUG_PRINT(x)
#define DEBUG_PRINTF(x, ...)
#define DEBUG_PRINTLN(x)
#endif

// ==========================================
// Hardware Watchdog Timeout
// If either FreeRTOS task hangs for this long, the board hard-resets.
// ==========================================
#define WDT_TIMEOUT_SECONDS 30

enum AlertState {
  STATE_NORMAL,
  STATE_WARNING,
  STATE_CRITICAL,
  STATE_RECOVERED
};

struct SystemAlert {
  const char *name;
  AlertState state;
  unsigned long abnormalStartTime;
  unsigned long normalStartTime;
  unsigned long lastLogTime;
  bool isCurrentlyAbnormal;
};

enum LogLevel { LEVEL_INFO, LEVEL_WARNING, LEVEL_ERROR, LEVEL_CRITICAL };

struct LogTracker {
  String lastAction;
  String lastDetails;
  unsigned long lastTime;
};

// ==========================================
// LAN8720 Ethernet Pin Definitions
// ==========================================
#define ETH_CLK_MODE ETH_CLOCK_GPIO17_OUT
#define ETH_POWER_PIN -1
#define ETH_TYPE ETH_PHY_LAN8720
#define ETH_ADDR 1
#define ETH_MDC_PIN 23
#define ETH_MDIO_PIN 18

bool ethConnected = false;
bool wifiConnected = false;
bool timeInitialized = false;

// ==========================================
// FreeRTOS Mutex for shared sensor/pump data
// Protects all variables read by networkTask and written by sensorTask.
// ==========================================
SemaphoreHandle_t sensorDataMutex = NULL;

// ==========================================
// Deferred-work flags.
// WiFi/ETH event callbacks run on the small "arduino_events" task, so they must
// NOT do HTTPS, NTP waits, or logging. They only set these flags, and
// networkTask does the heavy work.
// ==========================================
volatile bool needTimeInit = false;
volatile bool needAuth = false;
volatile bool needEthDownLog = false;
volatile bool needWifiDownLog = false;

// ==========================================
// Network Helper
// ==========================================
bool isNetworkConnected() { return ethConnected || wifiConnected; }

// ==========================================
// Sensor & Actuator Pin Definitions
// ==========================================
#define RELAY_PIN 32
#define PH_SENSOR_PIN 34
#define LEVEL_SENSOR_PIN 35

// ==========================================
// Tank ID & Firebase Endpoints Configuration
// ==========================================
const int TANK_ID = 1;

#define FIREBASE_HOST                                                          \
  "msu-water-monitoring-system-default-rtdb.asia-southeast1.firebasedatabase." \
  "app"

String getTankBasePath() { return "/tanks/" + String(TANK_ID); }

String getHistoryBasePath() { return "/history/tanks/" + String(TANK_ID); }

String getTankBaseUrl() {
  return "https://" FIREBASE_HOST + getTankBasePath() + ".json";
}

String getHistoryBaseUrl() {
  return "https://" FIREBASE_HOST + getHistoryBasePath() + ".json";
}

const char *firebaseLogsBaseURL = "https://" FIREBASE_HOST "/logs.json";
const char *firebaseConfigBaseURL = "https://" FIREBASE_HOST "/config.json";

// Firebase Authentication State
String firebaseIdToken = "";
String firebaseRefreshToken = "";
unsigned long tokenAcquiredTime = 0;
unsigned long tokenExpiresInMs = 3600000;          // Default 1 hour
const unsigned long TOKEN_REFRESH_MARGIN = 300000; // Refresh 5 min early
bool firebaseAuthValid = false;

// Append ?auth=<idToken> to every RTDB request
String getTanksUrl() {
  String url = getTankBaseUrl();
  if (firebaseIdToken.length() > 0) {
    return url + "?auth=" + firebaseIdToken;
  }
  return url;
}

String getLogsUrl() {
  if (firebaseIdToken.length() > 0) {
    return String(firebaseLogsBaseURL) + "?auth=" + firebaseIdToken;
  }
  return String(firebaseLogsBaseURL);
}

String getConfigUrl() {
  if (firebaseIdToken.length() > 0) {
    return String(firebaseConfigBaseURL) + "?auth=" + firebaseIdToken;
  }
  return String(firebaseConfigBaseURL);
}

String getHistoryUrl() {
  String url = getHistoryBaseUrl();
  if (firebaseIdToken.length() > 0) {
    return url + "?auth=" + firebaseIdToken;
  }
  return url;
}

// Persistent TLS client for low-latency command polling with HTTP Keep-Alive
WiFiClientSecure commandClient;
bool commandClientConfigured = false;

// ==========================================
// Global Variables
// ==========================================
bool lastPumpState = false;
bool currentPumpState = false;
bool lastSentPumpState = false;
unsigned long lastPumpStopTime = 0;
const unsigned long PUMP_MIN_OFF_TIME = 30000; // anti-chatter

float lastPhValue = 7.0;

bool lastActualPumpState = false;

// ==========================================
// Filtering, Decoupling, and Deadband Constants
// ==========================================
const int FILTER_MEDIAN_WINDOW = 5;
const int FILTER_AVERAGE_WINDOW = 10;

const int WATER_LEVEL_DEADBAND = 2;
const float PH_LEVEL_DEADBAND = 0.15;

const unsigned long COMMAND_POLL_INTERVAL = 1000;
unsigned long lastCommandPoll = 0;

const unsigned long SENSOR_WRITE_HEARTBEAT = 10000;
const unsigned long MIN_WRITE_INTERVAL = 1000;
unsigned long lastSensorWrite = 0;

int lastSentWaterLevelPercent = -999;
float lastSentWaterHeight = -999.0;
float lastSentPhValue = -999.0;

// Shared sensor data (protected by sensorDataMutex)
int stabilizedWaterLevelPercent = -999;
float stabilizedWaterHeight = -999.0;
float stabilizedPhValue = -999.0;

// =================================================================================
// Non-Blocking Sensor Circular Buffers & Scheduler Globals
// (only used by sensorTask - no mutex needed for these)
// =================================================================================
unsigned long lastSensorSampleTime = 0;
const unsigned long SENSOR_SAMPLE_INTERVAL = 20;

float levelRawSamples[FILTER_MEDIAN_WINDOW] = {0.0};
int levelRawIndex = 0;
bool levelBufferFilled = false;
float levelAverageHistory[FILTER_AVERAGE_WINDOW] = {0.0};
int levelAverageIndex = 0;
int levelAverageCount = 0;

float phRawSamples[FILTER_MEDIAN_WINDOW] = {0.0};
int phRawIndex = 0;
bool phBufferFilled = false;
float phAverageHistory[FILTER_AVERAGE_WINDOW] = {0.0};
int phAverageIndex = 0;
int phAverageCount = 0;

// =================================================================================
// Reconnection, Robustness & Micro-Scheduling Globals
// =================================================================================
unsigned long lastWifiRetry = 0;
int wifiReconnectAttempts = 0;
unsigned long wifiRetryInterval = 15000;

bool firebaseConnected = false;
int firebaseErrorCount = 0;
unsigned long currentCommandPollInterval = COMMAND_POLL_INTERVAL;

unsigned long lastSensorProcessingTime = 0;
const unsigned long SENSOR_PROCESSING_INTERVAL = 200;

// =================================================================================
// Network Watchdog Globals
// Tracks the last time a Firebase HTTPS request succeeded. If WiFi reports
// WL_CONNECTED but all HTTPS requests keep failing for > 90 seconds, the router
// has silently deauthenticated the board (zombie socket). Force a full WiFi
// reconnect to recover.
// =================================================================================
unsigned long lastFirebaseSuccessTime = 0;
const unsigned long NETWORK_WATCHDOG_TIMEOUT = 90000UL; // 90s

// =================================================================================
// Low-Heap Guard
// TLS handshakes require ~40 KB of contiguous internal heap. When free heap
// drops below this threshold, reset the persistent TLS commandClient before the
// allocator fails and causes a crash or hang.
// =================================================================================
const uint32_t MINIMUM_SAFE_HEAP = 60000; // bytes

// =================================================================================
// Sensor Calibration Parameters (adjusted dynamically via Firebase)
// =================================================================================
float levelVmin = 0.25;
float levelVmax = 3.00;
float tankHeight = 5.00;
float levelOffset = 0.00;
float phNeutralVoltage = 2.50;
float phSlope = 0.18;
float phOffset = 0.00;

// =================================================================================
// Sensor Health and Validation Status
// =================================================================================
bool phSensorOk = true;
bool levelSensorOk = true;

// =================================================================================
// Sensor Validation and Stabilization Rules
// =================================================================================
const float PH_SPIKE_THRESHOLD = 1.50;
const int LEVEL_SPIKE_THRESHOLD = 15;
const int STABILIZATION_SAMPLES = 15;
const unsigned long SENSOR_FAULT_TIMEOUT = 10000;

int consecutivePhSpikes = 0;
unsigned long phFaultTimer = 0;
unsigned long phRecoveryTimer = 0;

int consecutiveLevelSpikes = 0;
unsigned long levelFaultTimer = 0;
unsigned long levelRecoveryTimer = 0;

// =================================================================================
// Alert Validation, False Alarm Prevention, and Status Handling
// =================================================================================
float lowLevelThreshold = 15.0;
float overflowThreshold = 95.0;
float minPh = 6.5;
float maxPh = 8.5;
bool maintenanceMode = false;
bool pumpControlLock = false;

SystemAlert lowLevelAlert = {"Low Water Level", STATE_NORMAL, 0, 0, 0, false};
SystemAlert highLevelAlert = {"High Water Level", STATE_NORMAL, 0, 0, 0, false};
SystemAlert phAlert = {"Unsafe pH Level", STATE_NORMAL, 0, 0, 0, false};

AlertState lastSentLowLevelAlertState = STATE_NORMAL;
AlertState lastSentHighLevelAlertState = STATE_NORMAL;
AlertState lastSentPhAlertState = STATE_NORMAL;

const unsigned long ALERT_VALIDATION_TIME = 5000;
const unsigned long RECOVERY_VALIDATION_TIME = 5000;
const unsigned long COOLDOWN_DURATION = 60000;

String getAlertStateStr(AlertState s) {
  switch (s) {
  case STATE_NORMAL:
    return "NORMAL";
  case STATE_WARNING:
    return "WARNING";
  case STATE_CRITICAL:
    return "CRITICAL";
  case STATE_RECOVERED:
    return "RECOVERED";
  }
  return "NORMAL";
}

// =================================================================================
// Optimized Categorized Logging & Duplicate Suppression Definitions
// =================================================================================
String getLogLevelStr(LogLevel l) {
  switch (l) {
  case LEVEL_INFO:
    return "INFO";
  case LEVEL_WARNING:
    return "WARNING";
  case LEVEL_ERROR:
    return "ERROR";
  case LEVEL_CRITICAL:
    return "CRITICAL";
  }
  return "INFO";
}

LogTracker lastLoggedEvent = {"", "", 0};
const unsigned long LOG_DUPLICATE_COOLDOWN = 300000; // 5 minutes

bool shouldSuppressLog(String action, String details) {
  unsigned long now = millis();
  if (action == lastLoggedEvent.lastAction &&
      details == lastLoggedEvent.lastDetails) {
    if (now - lastLoggedEvent.lastTime < LOG_DUPLICATE_COOLDOWN) {
      return true;
    }
  }
  return false;
}

// Forward Declarations
void logSystemEvent(String action, String details, LogLevel level = LEVEL_INFO);
bool ensureFirebaseAuth();
bool firebaseSignIn();
bool firebaseRefreshTokenFunc();
String getStringFromJson(const String &json, const String &key);
String getTanksUrl();
String getLogsUrl();
String getConfigUrl();
String getHistoryUrl();
void postHistorySample();
void pushRamLog(const String &payload);
void flushRamLogBuffer();
void updateFirebasePumpState(bool pumpState);
void processAutomaticPumpControl();

void updateAlertState(SystemAlert &alert, bool abnormalCondition,
                      String details) {
  unsigned long now = millis();
  alert.isCurrentlyAbnormal = abnormalCondition;

  switch (alert.state) {
  case STATE_NORMAL:
    if (abnormalCondition) {
      if (alert.abnormalStartTime == 0) {
        alert.abnormalStartTime = now;
      } else if (now - alert.abnormalStartTime >= ALERT_VALIDATION_TIME) {
        if (strcmp(alert.name, "High Water Level") == 0) {
          alert.state = STATE_WARNING;
          logSystemEvent(String(alert.name) + " Alert",
                         details + " [Status: Triggered]", LEVEL_WARNING);
        } else {
          alert.state = STATE_CRITICAL;
          logSystemEvent(String(alert.name) + " Alert",
                         details + " [Status: Triggered]", LEVEL_CRITICAL);
        }
        alert.abnormalStartTime = 0;
        alert.lastLogTime = now;
      }
    } else {
      alert.abnormalStartTime = 0;
    }
    break;

  case STATE_WARNING:
  case STATE_CRITICAL:
    if (!abnormalCondition) {
      if (alert.normalStartTime == 0) {
        alert.normalStartTime = now;
      } else if (now - alert.normalStartTime >= RECOVERY_VALIDATION_TIME) {
        alert.state = STATE_RECOVERED;
        alert.normalStartTime = 0;
        alert.lastLogTime = now;
        logSystemEvent(String(alert.name) + " Alert",
                       details + " [Status: Recovered]", LEVEL_INFO);
      }
    } else {
      alert.normalStartTime = 0;
      if (now - alert.lastLogTime >= COOLDOWN_DURATION) {
        alert.lastLogTime = now;
        logSystemEvent(
            String(alert.name) + " Alert", details + " [Status: Persistent]",
            (alert.state == STATE_WARNING) ? LEVEL_WARNING : LEVEL_CRITICAL);
      }
    }
    break;

  case STATE_RECOVERED:
    alert.state = STATE_NORMAL;
    alert.abnormalStartTime = 0;
    alert.normalStartTime = 0;
    break;
  }
}

// ==========================================
// Helper: Get Formatted Time String
// ==========================================
String getTimeString() {
  if (!timeInitialized) {
    return String(millis()) + "ms";
  }
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return String(millis()) + "ms";
  }
  char timeStringBuff[50];
  strftime(timeStringBuff, sizeof(timeStringBuff), "%Y-%m-%d %H:%M:%S",
           &timeinfo);
  return String(timeStringBuff);
}

// ==========================================
// RAM Ring Buffer for Offline Critical & Error Logs (20 entries)
// ==========================================
const int RAM_LOG_BUFFER_SIZE = 20;
String ramLogBuffer[RAM_LOG_BUFFER_SIZE];
int ramLogHead = 0;
int ramLogTail = 0;
int ramLogCount = 0;

void pushRamLog(const String &payload) {
  if (sensorDataMutex &&
      xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
    ramLogBuffer[ramLogHead] = payload;
    ramLogHead = (ramLogHead + 1) % RAM_LOG_BUFFER_SIZE;
    if (ramLogCount < RAM_LOG_BUFFER_SIZE) {
      ramLogCount++;
    } else {
      ramLogTail = (ramLogTail + 1) % RAM_LOG_BUFFER_SIZE;
      DEBUG_PRINTLN(
          "[RamLogBuffer] 20-entry buffer full. Oldest log overwritten.");
    }
    DEBUG_PRINTF(
        "[RamLogBuffer] Buffered critical/error log. Buffer count: %d/%d\n",
        ramLogCount, RAM_LOG_BUFFER_SIZE);
    xSemaphoreGive(sensorDataMutex);
  }
}

void flushRamLogBuffer() {
  if (ramLogCount == 0)
    return;
  if (!isNetworkConnected())
    return;
  if (!ensureFirebaseAuth())
    return;

  DEBUG_PRINTF("[RamLogBuffer] Firebase reconnected. Flushing %d buffered "
               "log(s) to /logs...\n",
               ramLogCount);

  while (ramLogCount > 0) {
    if (!isNetworkConnected()) {
      DEBUG_PRINTLN("[RamLogBuffer] Network connection interrupted during "
                    "flush. Pausing.");
      break;
    }

    String payload = "";
    if (sensorDataMutex &&
        xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      if (ramLogCount > 0) {
        payload = ramLogBuffer[ramLogTail];
      }
      xSemaphoreGive(sensorDataMutex);
    }
    if (payload.length() == 0)
      break;

    WiFiClientSecure secureClient;
    secureClient.setInsecure();
    HTTPClient http;
    http.begin(secureClient, getLogsUrl());
    http.setTimeout(1500);
    http.addHeader("Content-Type", "application/json");

    int httpResponseCode = http.sendRequest("POST", payload);

    if (httpResponseCode == 401) {
      DEBUG_PRINTLN("[FirebaseAuth] Received 401 Unauthorized during flush. "
                    "Invalidating token.");
      firebaseAuthValid = false;
      http.end();
      break;
    }

    if (httpResponseCode >= 200 && httpResponseCode < 300) {
      DEBUG_PRINTF("[RamLogBuffer] Successfully flushed log to /logs (HTTP "
                   "%d). Remaining: %d\n",
                   httpResponseCode, ramLogCount - 1);
      if (sensorDataMutex &&
          xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        ramLogBuffer[ramLogTail] = "";
        ramLogTail = (ramLogTail + 1) % RAM_LOG_BUFFER_SIZE;
        ramLogCount--;
        xSemaphoreGive(sensorDataMutex);
      }
      http.end();
      vTaskDelay(pdMS_TO_TICKS(10));
    } else {
      DEBUG_PRINTF("[RamLogBuffer] HTTP error sending buffered log: %d. "
                   "Pausing flush.\n",
                   httpResponseCode);
      http.end();
      break;
    }
  }
}

// ==========================================
// Logging System (Firebase)
// NOTE: never call this from a WiFi/ETH event callback (it does HTTPS).
// ==========================================
void logSystemEvent(String action, String details, LogLevel level) {
  if (shouldSuppressLog(action, details)) {
    DEBUG_PRINTF("[SUPPRESSED DUPLICATE LOG] Action: %s, Details: %s\n",
                 action.c_str(), details.c_str());
    return;
  }

  lastLoggedEvent.lastAction = action;
  lastLoggedEvent.lastDetails = details;
  lastLoggedEvent.lastTime = millis();

  String logStr = "[" + getTimeString() + "] [" + getLogLevelStr(level) + "] " +
                  action + " - " + details;
  Serial.println(logStr);

  String dummyId = "esp32-" + String(millis());

  String jsonPayload;
  jsonPayload.reserve(300);

  jsonPayload = "{";
  jsonPayload += "\"id\":\"" + dummyId + "\",";
  jsonPayload += "\"action\":\"" + action + "\",";
  jsonPayload +=
      "\"details\":\"" + details + " (Local Time: " + getTimeString() + ")\",";
  jsonPayload += "\"performedBy\":\"ESP32 System\",";
  jsonPayload += "\"logLevel\":\"" + getLogLevelStr(level) + "\",";
  jsonPayload += "\"timestamp\":{\".sv\":\"timestamp\"}";
  jsonPayload += "}";

  bool isCriticalOrError = (level == LEVEL_CRITICAL || level == LEVEL_ERROR);

  // CRITICAL FIX: If called from sensorTask (Core 1), do NOT execute HTTPS!
  // Doing mbedTLS on Core 1's smaller stack causes stack overflow and crashes.
  // Buffer the log in RAM so networkTask (Core 0) can flush it safely.
  if (xPortGetCoreID() == 1) {
    pushRamLog(jsonPayload);
    return;
  }

  bool sentSuccessfully = false;

  if (isNetworkConnected()) {
    ensureFirebaseAuth();

    WiFiClientSecure secureClient;
    secureClient.setInsecure();
    HTTPClient http;
    http.begin(secureClient, getLogsUrl());
    http.setTimeout(1500);
    http.addHeader("Content-Type", "application/json");

    int httpResponseCode = http.sendRequest("POST", jsonPayload);
    if (httpResponseCode == 401) {
      DEBUG_PRINTLN(
          "[FirebaseAuth] Received 401 Unauthorized in logSystemEvent.");
      firebaseAuthValid = false;
    }

    if (httpResponseCode >= 200 && httpResponseCode < 300) {
      sentSuccessfully = true;
      DEBUG_PRINTF("Log seamlessly tracking on Web System. Firebase Code: %d\n",
                   httpResponseCode);
    } else {
      DEBUG_PRINTF("Error syncing log to Web System. Code: %s\n",
                   http.errorToString(httpResponseCode).c_str());
    }
    http.end();
  }

  if (!sentSuccessfully && isCriticalOrError) {
    pushRamLog(jsonPayload);
  }
}

// ==========================================
// NTP Time Sync (called from networkTask, NOT from the event callback)
// ==========================================
void initTime() {
  Serial.println("Syncing Time from NTP Server...");
  configTime(8 * 3600, 0, "pool.ntp.org", "time.nist.gov");

  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 2000)) { // Wait up to 2 seconds for sync
                                       // (prevents long startup blockage)
    timeInitialized = true;
    logSystemEvent(
        "System Power Tracker",
        "Device Powered ON & Hardware Clock Synced. ESP32 is fully active.",
        LEVEL_INFO);
  } else {
    Serial.println("Failed to get accurate time from NTP.");
  }
}

// ==========================================
// Network Event Handler
// Runs on the small arduino_events task. ONLY set flags / print here.
// ==========================================
void WiFiEvent(arduino_event_id_t event) {
  switch (event) {
  case ARDUINO_EVENT_ETH_START:
    Serial.println("ETH Started");
    ETH.setHostname("esp32-water-monitor");
    break;
  case ARDUINO_EVENT_ETH_CONNECTED:
    Serial.println("ETH Connected");
    break;
  case ARDUINO_EVENT_ETH_GOT_IP:
    Serial.print("ETH IP: ");
    Serial.println(ETH.localIP());
    ethConnected = true;
    needTimeInit = !timeInitialized;
    needAuth = true;
    break;
  case ARDUINO_EVENT_ETH_DISCONNECTED:
    Serial.println("ETH Disconnected");
    if (ethConnected) {
      ethConnected = false;
      needEthDownLog = true;
    }
    break;

  case ARDUINO_EVENT_WIFI_STA_CONNECTED:
    Serial.println("WiFi Connected");
    break;
  case ARDUINO_EVENT_WIFI_STA_GOT_IP:
    Serial.print("WiFi IP: ");
    Serial.println(WiFi.localIP());
    wifiConnected = true;
    needTimeInit = !timeInitialized;
    needAuth = true;
    break;
  case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
    Serial.println("WiFi Disconnected");
    if (wifiConnected) {
      wifiConnected = false;
      needWifiDownLog = true;
    }
    break;

  default:
    break;
  }
}

// Runs at the top of networkTask: does the work the event callback deferred.
void processDeferredNetworkWork() {
  if (needEthDownLog) {
    needEthDownLog = false;
    logSystemEvent("Network Alert",
                   "Ethernet connection unexpectedly disconnected",
                   LEVEL_CRITICAL);
  }
  if (needWifiDownLog) {
    needWifiDownLog = false;
    logSystemEvent("Network Alert", "WiFi backup connection disconnected",
                   LEVEL_WARNING);
  }
  if (needTimeInit && isNetworkConnected()) {
    needTimeInit = false;
    if (!timeInitialized)
      initTime();
  }
  if (needAuth && isNetworkConnected()) {
    needAuth = false;
    ensureFirebaseAuth();
  }
}

// ==========================================
// Signal Filtering Implementation
// ==========================================
void sortArray(float arr[], int n) {
  for (int i = 0; i < n - 1; i++) {
    for (int j = 0; j < n - i - 1; j++) {
      if (arr[j] > arr[j + 1]) {
        float temp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = temp;
      }
    }
  }
}

// Non-blocking sampling routine called every SENSOR_SAMPLE_INTERVAL ms.
void sampleSensorsNonBlocking() {
  unsigned long now = millis();
  if (now - lastSensorSampleTime >= SENSOR_SAMPLE_INTERVAL) {
    lastSensorSampleTime = now;

    levelRawSamples[levelRawIndex] =
        (analogRead(LEVEL_SENSOR_PIN) / 4095.0) * 3.3;
    levelRawIndex = (levelRawIndex + 1) % FILTER_MEDIAN_WINDOW;
    if (levelRawIndex == 0) {
      levelBufferFilled = true;
    }

    phRawSamples[phRawIndex] = (analogRead(PH_SENSOR_PIN) / 4095.0) * 3.3;
    phRawIndex = (phRawIndex + 1) % FILTER_MEDIAN_WINDOW;
    if (phRawIndex == 0) {
      phBufferFilled = true;
    }
  }
}

float readLevelVoltageStable() {
  if (!levelBufferFilled) {
    return (analogRead(LEVEL_SENSOR_PIN) / 4095.0) * 3.3;
  }

  float tempSamples[FILTER_MEDIAN_WINDOW];
  memcpy(tempSamples, levelRawSamples, sizeof(levelRawSamples));
  sortArray(tempSamples, FILTER_MEDIAN_WINDOW);
  float medianVal = tempSamples[FILTER_MEDIAN_WINDOW / 2];

  levelAverageHistory[levelAverageIndex] = medianVal;
  levelAverageIndex = (levelAverageIndex + 1) % FILTER_AVERAGE_WINDOW;
  if (levelAverageCount < FILTER_AVERAGE_WINDOW) {
    levelAverageCount++;
  }

  float sum = 0.0;
  for (int i = 0; i < levelAverageCount; i++) {
    sum += levelAverageHistory[i];
  }
  return sum / levelAverageCount;
}

float readPhVoltageStable() {
  if (!phBufferFilled) {
    return (analogRead(PH_SENSOR_PIN) / 4095.0) * 3.3;
  }

  float tempSamples[FILTER_MEDIAN_WINDOW];
  memcpy(tempSamples, phRawSamples, sizeof(phRawSamples));
  sortArray(tempSamples, FILTER_MEDIAN_WINDOW);
  float medianVal = tempSamples[FILTER_MEDIAN_WINDOW / 2];

  phAverageHistory[phAverageIndex] = medianVal;
  phAverageIndex = (phAverageIndex + 1) % FILTER_AVERAGE_WINDOW;
  if (phAverageCount < FILTER_AVERAGE_WINDOW) {
    phAverageCount++;
  }

  float sum = 0.0;
  for (int i = 0; i < phAverageCount; i++) {
    sum += phAverageHistory[i];
  }
  return sum / phAverageCount;
}

// ==========================================
// JSON Parsing Helpers
// ==========================================
bool getBoolFromJson(String json, String key) {
  int keyIndex = json.indexOf("\"" + key + "\"");
  if (keyIndex == -1)
    return false;

  int colonIndex = json.indexOf(":", keyIndex);
  if (colonIndex == -1)
    return false;

  int valStart = colonIndex + 1;
  while (valStart < json.length() &&
         (json[valStart] == ' ' || json[valStart] == '\t' ||
          json[valStart] == '\r' || json[valStart] == '\n')) {
    valStart++;
  }

  if (json.substring(valStart).startsWith("true")) {
    return true;
  }
  return false;
}

bool hasKeyInJson(String json, String key) {
  return json.indexOf("\"" + key + "\"") != -1;
}

// Returns -999.0 if the key is not found or parsing fails
float getFloatFromJson(String json, String key) {
  int keyIndex = json.indexOf("\"" + key + "\"");
  if (keyIndex == -1)
    return -999.0;

  int colonIndex = json.indexOf(":", keyIndex);
  if (colonIndex == -1)
    return -999.0;

  int valStart = colonIndex + 1;
  while (valStart < json.length() &&
         (json[valStart] == ' ' || json[valStart] == '\t' ||
          json[valStart] == '\r' || json[valStart] == '\n')) {
    valStart++;
  }

  int valEnd = valStart;
  while (valEnd < json.length() &&
         (isDigit(json[valEnd]) || json[valEnd] == '.' || json[valEnd] == '-' ||
          json[valEnd] == '+')) {
    valEnd++;
  }

  if (valStart == valEnd)
    return -999.0;
  return json.substring(valStart, valEnd).toFloat();
}

String getStringFromJson(const String &json, const String &key) {
  String searchKey = "\"" + key + "\"";
  int keyIndex = json.indexOf(searchKey);
  if (keyIndex == -1)
    return "";

  int colonIndex = json.indexOf(":", keyIndex + searchKey.length());
  if (colonIndex == -1)
    return "";

  int start = colonIndex + 1;
  while (start < json.length() &&
         (json[start] == ' ' || json[start] == '\t' || json[start] == '\r' ||
          json[start] == '\n')) {
    start++;
  }
  if (start >= json.length())
    return "";

  if (json[start] == '\"') {
    int endQuote = json.indexOf('\"', start + 1);
    if (endQuote == -1)
      return "";
    return json.substring(start + 1, endQuote);
  } else {
    int end = start;
    while (end < json.length() && json[end] != ',' && json[end] != '}' &&
           json[end] != ']' && json[end] != ' ' && json[end] != '\r' &&
           json[end] != '\n') {
      end++;
    }
    return json.substring(start, end);
  }
}

// ==========================================
// Firebase Authentication Implementations
// ==========================================

// Authenticate using identitytoolkit signInWithPassword REST endpoint
bool firebaseSignIn() {
  if (!isNetworkConnected()) {
    DEBUG_PRINTLN("[FirebaseAuth] Cannot sign in: Network is offline.");
    return false;
  }

  Serial.println(
      "[FirebaseAuth] Authenticating via REST API (signInWithPassword)...");

  String url = "https://identitytoolkit.googleapis.com/v1/"
               "accounts:signInWithPassword?key=" +
               String(FIREBASE_API_KEY);

  String payload = "{";
  payload += "\"email\":\"" + String(FIREBASE_AUTH_EMAIL) + "\",";
  payload += "\"password\":\"" + String(FIREBASE_AUTH_PASSWORD) + "\",";
  payload += "\"returnSecureToken\":true";
  payload += "}";

  WiFiClientSecure secureClient;
  secureClient.setInsecure();
  HTTPClient http;
  http.begin(secureClient, url);
  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(payload);
  if (code == 200) {
    String response = http.getString();
    String idTok = getStringFromJson(response, "idToken");
    String refTok = getStringFromJson(response, "refreshToken");
    String expStr = getStringFromJson(response, "expiresIn");

    if (idTok.length() > 0) {
      firebaseIdToken = idTok;
      if (refTok.length() > 0) {
        firebaseRefreshToken = refTok;
      }
      long expSec = expStr.toInt();
      if (expSec > 0) {
        tokenExpiresInMs = expSec * 1000UL;
      } else {
        tokenExpiresInMs = 3600000UL;
      }
      tokenAcquiredTime = millis();
      firebaseAuthValid = true;
      Serial.println("[FirebaseAuth] Sign-in successful! ID token acquired.");
      http.end();
      return true;
    } else {
      Serial.println("[FirebaseAuth] Error: HTTP 200 received but idToken key "
                     "was missing.");
    }
  } else {
    Serial.printf("[FirebaseAuth] Sign-in failed. HTTP status code: %d\n",
                  code);
  }
  http.end();
  firebaseAuthValid = false;
  return false;
}

// Refresh ID token using securetoken.googleapis.com REST endpoint
bool firebaseRefreshTokenFunc() {
  if (!isNetworkConnected()) {
    return false;
  }
  if (firebaseRefreshToken.length() == 0) {
    Serial.println("[FirebaseAuth] No refresh token found. Re-authenticating "
                   "via password...");
    return firebaseSignIn();
  }

  Serial.println(
      "[FirebaseAuth] Refreshing ID token via securetoken.googleapis.com...");

  String url = "https://securetoken.googleapis.com/v1/token?key=" +
               String(FIREBASE_API_KEY);
  String body =
      "grant_type=refresh_token&refresh_token=" + firebaseRefreshToken;

  WiFiClientSecure secureClient;
  secureClient.setInsecure();
  HTTPClient http;
  http.begin(secureClient, url);
  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");

  int code = http.POST(body);
  if (code == 200) {
    String response = http.getString();
    String newIdTok = getStringFromJson(response, "id_token");
    String newRefTok = getStringFromJson(response, "refresh_token");
    String expStr = getStringFromJson(response, "expires_in");

    if (newIdTok.length() > 0) {
      firebaseIdToken = newIdTok;
      if (newRefTok.length() > 0) {
        firebaseRefreshToken = newRefTok;
      }
      long expSec = expStr.toInt();
      if (expSec > 0) {
        tokenExpiresInMs = expSec * 1000UL;
      } else {
        tokenExpiresInMs = 3600000UL;
      }
      tokenAcquiredTime = millis();
      firebaseAuthValid = true;
      Serial.println("[FirebaseAuth] ID token successfully refreshed!");
      http.end();
      return true;
    } else {
      Serial.println("[FirebaseAuth] Error: HTTP 200 but id_token missing in "
                     "refresh response.");
    }
  } else {
    Serial.printf("[FirebaseAuth] Token refresh failed (HTTP %d). "
                  "Re-authenticating via password...\n",
                  code);
  }
  http.end();

  return firebaseSignIn();
}

// Ensure an active auth token is available (refreshes ~5 min before expiry)
bool ensureFirebaseAuth() {
  if (!isNetworkConnected()) {
    return false;
  }

  unsigned long now = millis();

  if (!firebaseAuthValid || firebaseIdToken.length() == 0) {
    return firebaseSignIn();
  }

  if (now - tokenAcquiredTime >= (tokenExpiresInMs - TOKEN_REFRESH_MARGIN)) {
    return firebaseRefreshTokenFunc();
  }

  return true;
}

// =================================================================================
// pH Sensor Processing Pipeline (Reading -> Validation -> Calibration ->
// Output)
// =================================================================================
void processPhSensor() {
  float rawPhVoltage = readPhVoltageStable();

  bool electricalValid = (rawPhVoltage > 0.05 && rawPhVoltage < 3.25);

  // pH = 7.0 + ((Neutral_V - Raw_V) / Slope) + pH_Offset
  float phVal = 7.0 + ((phNeutralVoltage - rawPhVoltage) / phSlope) + phOffset;

  bool physicalValid = (phVal >= 0.0 && phVal <= 14.0);
  bool readingValid = electricalValid && physicalValid;

  unsigned long now = millis();

  if (!readingValid) {
    if (phFaultTimer == 0) {
      phFaultTimer = now;
    }
    phRecoveryTimer = 0;
    consecutivePhSpikes = 0;

    if (phSensorOk && (now - phFaultTimer >= SENSOR_FAULT_TIMEOUT)) {
      phSensorOk = false;
      logSystemEvent("Sensor Fault",
                     "pH Sensor FAULT! Out-of-bounds readings. Voltage: " +
                         String(rawPhVoltage, 2) + "V, pH: " + String(phVal, 2),
                     LEVEL_CRITICAL);
    }
    return;
  }

  phFaultTimer = 0;

  if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(5)) == pdTRUE) {
    if (stabilizedPhValue == -999.0) {
      stabilizedPhValue = phVal;
      phSensorOk = true;
      xSemaphoreGive(sensorDataMutex);
      return;
    }

    float diff = abs(phVal - stabilizedPhValue);
    if (diff >= PH_SPIKE_THRESHOLD) {
      consecutivePhSpikes++;
      if (consecutivePhSpikes >= STABILIZATION_SAMPLES) {
        stabilizedPhValue = phVal;
        consecutivePhSpikes = 0;
        DEBUG_PRINTLN("pH sensor stabilized at new value: " + String(phVal, 2));
      } else {
        DEBUG_PRINTLN("pH spike ignored (count=" + String(consecutivePhSpikes) +
                      "): " + String(phVal, 2));
      }
    } else {
      consecutivePhSpikes = 0;
      if (!phSensorOk) {
        if (phRecoveryTimer == 0) {
          phRecoveryTimer = now;
        } else if (now - phRecoveryTimer >= 3000) {
          phSensorOk = true;
          phRecoveryTimer = 0;
          xSemaphoreGive(sensorDataMutex);
          logSystemEvent(
              "Sensor Recovery",
              "pH sensor has recovered and is sending stable readings",
              LEVEL_INFO);
          return;
        }
      }
      if (abs(phVal - stabilizedPhValue) >= PH_LEVEL_DEADBAND) {
        stabilizedPhValue = phVal;
      }
    }
    xSemaphoreGive(sensorDataMutex);
  }
}

// =================================================================================
// Water Level Sensor Processing Pipeline
// =================================================================================
void processLevelSensor() {
  float rawLevelVoltage = readLevelVoltageStable();

  bool electricalValid = (rawLevelVoltage > 0.05 && rawLevelVoltage < 3.25);

  float valRange = levelVmax - levelVmin;
  float height = 0.0;
  if (abs(valRange) > 0.001) {
    height = (rawLevelVoltage - levelVmin) * (tankHeight / valRange);
  }

  bool physicalValid = (height >= -0.5 && height <= (tankHeight + 0.5));
  bool readingValid = electricalValid && physicalValid;

  unsigned long now = millis();

  if (!readingValid) {
    if (levelFaultTimer == 0) {
      levelFaultTimer = now;
    }
    levelRecoveryTimer = 0;
    consecutiveLevelSpikes = 0;

    if (levelSensorOk && (now - levelFaultTimer >= SENSOR_FAULT_TIMEOUT)) {
      levelSensorOk = false;
      logSystemEvent(
          "Sensor Fault",
          "Water Level Sensor FAULT! Out-of-bounds readings. Voltage: " +
              String(rawLevelVoltage, 2) + "V, Height: " + String(height, 2) +
              "m",
          LEVEL_CRITICAL);
    }
    return;
  }

  levelFaultTimer = 0;

  float clampedHeight = height;
  if (clampedHeight < 0.0)
    clampedHeight = 0.0;
  if (clampedHeight > tankHeight)
    clampedHeight = tankHeight;

  int levelPercent = (clampedHeight / tankHeight) * 100;
  levelPercent += (int)levelOffset;
  if (levelPercent < 0)
    levelPercent = 0;
  if (levelPercent > 100)
    levelPercent = 100;

  if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(5)) == pdTRUE) {
    if (stabilizedWaterLevelPercent == -999) {
      stabilizedWaterLevelPercent = levelPercent;
      stabilizedWaterHeight = clampedHeight;
      levelSensorOk = true;
      xSemaphoreGive(sensorDataMutex);
      return;
    }

    int diff = abs(levelPercent - stabilizedWaterLevelPercent);
    if (diff >= LEVEL_SPIKE_THRESHOLD) {
      consecutiveLevelSpikes++;
      if (consecutiveLevelSpikes >= STABILIZATION_SAMPLES) {
        stabilizedWaterLevelPercent = levelPercent;
        stabilizedWaterHeight = clampedHeight;
        consecutiveLevelSpikes = 0;
        DEBUG_PRINTLN("Level sensor stabilized at new value: " +
                      String(levelPercent) + "%");
      } else {
        DEBUG_PRINTLN(
            "Level spike ignored (count=" + String(consecutiveLevelSpikes) +
            "): " + String(levelPercent) + "%");
      }
    } else {
      consecutiveLevelSpikes = 0;
      if (!levelSensorOk) {
        if (levelRecoveryTimer == 0) {
          levelRecoveryTimer = now;
        } else if (now - levelRecoveryTimer >= 3000) {
          levelSensorOk = true;
          levelRecoveryTimer = 0;
          xSemaphoreGive(sensorDataMutex);
          logSystemEvent(
              "Sensor Recovery",
              "Water Level sensor has recovered and is sending stable readings",
              LEVEL_INFO);
          return;
        }
      }
      if (abs(levelPercent - stabilizedWaterLevelPercent) >=
          WATER_LEVEL_DEADBAND) {
        stabilizedWaterLevelPercent = levelPercent;
        stabilizedWaterHeight = clampedHeight;
      }
    }
    xSemaphoreGive(sensorDataMutex);
  }
}

// =================================================================================
// Connection Manager (WiFi Reconnection & Non-Blocking Backoff)
// =================================================================================
void manageConnections() {
  unsigned long now = millis();

  if (ethConnected) {
    if (wifiConnected) {
      wifiConnected = false;
      DEBUG_PRINTLN("Ethernet is active. Disabling backup WiFi flag.");
    }
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (wifiConnected) {
      wifiConnected = false;
      logSystemEvent("Network Alert", "WiFi backup connection lost!",
                     LEVEL_WARNING);
    }

    if (now - lastWifiRetry >= wifiRetryInterval) {
      lastWifiRetry = now;
      wifiReconnectAttempts++;

      // Backoff: 15s -> 30s -> 60s max
      if (wifiReconnectAttempts == 1)
        wifiRetryInterval = 15000;
      else if (wifiReconnectAttempts == 2)
        wifiRetryInterval = 30000;
      else
        wifiRetryInterval = 60000;

      Serial.printf(
          "Attempting WiFi reconnection (Attempt %d)... Next retry in %lds\n",
          wifiReconnectAttempts, wifiRetryInterval / 1000);

      WiFi.disconnect();
      WiFi.setSleep(false);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  } else {
    if (!wifiConnected) {
      wifiConnected = true;
      wifiReconnectAttempts = 0;
      wifiRetryInterval = 15000;
      WiFi.setSleep(false);
      logSystemEvent("Network Recovery",
                     "WiFi backup connection established successfully.",
                     LEVEL_INFO);
    }
  }
}

// =================================================================================
// Network Watchdog - Zombie Socket Detector
// WiFi.status() can return WL_CONNECTED even after the router silently deauths
// the board (e.g. ARP timeout, DHCP lease expired, router restart). In this
// state all HTTPS calls fail but no disconnect event fires. This function
// detects the condition by checking how long it has been since any Firebase
// call succeeded, and forces a full WiFi reconnect to tear down the zombie TCP
// stack.
// =================================================================================
void checkNetworkWatchdog() {
  if (ethConnected)
    return;
  if (!wifiConnected)
    return;

  unsigned long now = millis();
  unsigned long referenceTime =
      (lastFirebaseSuccessTime > 0)
          ? lastFirebaseSuccessTime
          : (now < NETWORK_WATCHDOG_TIMEOUT
                 ? 0
                 : now - NETWORK_WATCHDOG_TIMEOUT - 1);

  if (referenceTime == 0)
    return;

  if ((now - referenceTime) >= NETWORK_WATCHDOG_TIMEOUT) {
    Serial.printf(
        "[NetworkWatchdog] HTTPS failing for %lus despite WL_CONNECTED. "
        "Router may have silently deauthenticated. Forcing WiFi reconnect.\n",
        (now - referenceTime) / 1000);
    logSystemEvent("Network Watchdog",
                   "Forced WiFi reconnect: HTTPS failing for 90s while "
                   "WL_CONNECTED (zombie socket).",
                   LEVEL_WARNING);

    commandClient.stop();
    commandClientConfigured = false;
    firebaseConnected = false;
    firebaseAuthValid = false;
    wifiConnected = false;
    lastFirebaseSuccessTime = 0;

    WiFi.disconnect(true);
    vTaskDelay(pdMS_TO_TICKS(500));
    WiFi.setSleep(false);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    lastWifiRetry = now;
    wifiReconnectAttempts = 0;
    wifiRetryInterval = 15000;
  }
}

// ==========================================
// Pump Control & Synchronization Helper
// ==========================================
void updateFirebasePumpState(bool pumpState) {
  lastSentPumpState = pumpState;
  if (isNetworkConnected()) {
    if (ensureFirebaseAuth()) {
      WiFiClientSecure secureClient;
      secureClient.setInsecure();
      HTTPClient http;
      http.begin(secureClient, getTanksUrl());
      http.setTimeout(1500);
      http.addHeader("Content-Type", "application/json");
      String patchPayload =
          "{\"pumpOn\":" + String(pumpState ? "true" : "false") +
          ",\"lastUpdate\":{\".sv\":\"timestamp\"}}";
      int code = http.sendRequest("PATCH", patchPayload);
      if (code == 401) {
        DEBUG_PRINTLN(
            "[FirebaseAuth] Received 401 in updateFirebasePumpState.");
        firebaseAuthValid = false;
      }
      if (code >= 200 && code < 300) {
        lastSensorWrite = millis();
        DEBUG_PRINTF("[Pump] Updated pumpOn in tanks/%d to %s (HTTP %d)\n",
                     TANK_ID, pumpState ? "true" : "false", code);
      } else {
        DEBUG_PRINTF("[Pump] Failed to PATCH pumpOn in tanks/%d. Code: %d\n",
                     TANK_ID, code);
      }
      http.end();
    }
  }
}

void processAutomaticPumpControl() {
  unsigned long now = millis();

  // Snapshot sensor values under mutex
  int levelPercent;
  bool levelOk;
  if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(5)) == pdTRUE) {
    levelPercent = stabilizedWaterLevelPercent;
    levelOk = levelSensorOk;
    xSemaphoreGive(sensorDataMutex);
  } else {
    return;
  }

  // Rule 1: maintenanceMode forces the pump OFF and blocks automatic starts.
  if (maintenanceMode) {
    if (currentPumpState) {
      currentPumpState = false;
      lastPumpStopTime = now;
      logSystemEvent(
          "Pump Controller",
          "Pump stopped automatically. Water level: " + String(levelPercent) +
              "%. Reason: Maintenance mode active.",
          LEVEL_WARNING);
      updateFirebasePumpState(false);
    }
    return;
  }

  // Rule 3: faulty level sensor -> never auto-start, stop if running.
  if (!levelOk) {
    if (currentPumpState) {
      currentPumpState = false;
      lastPumpStopTime = now;
      logSystemEvent(
          "Pump Controller",
          "Pump stopped automatically. Water level: " + String(levelPercent) +
              "%. Reason: Water level sensor faulty.",
          LEVEL_CRITICAL);
      updateFirebasePumpState(false);
    }
    return;
  }

  if (levelPercent < 0) {
    return;
  }

  // Rule 2: overflow shutoff always applies.
  if (currentPumpState && (levelPercent >= (int)overflowThreshold)) {
    currentPumpState = false;
    lastPumpStopTime = now;
    logSystemEvent(
        "Pump Controller",
        "Pump stopped automatically. Water level: " + String(levelPercent) +
            "% reached overflow threshold (" + String((int)overflowThreshold) +
            "%). Reason: Overflow shutoff protection.",
        LEVEL_INFO);
    updateFirebasePumpState(false);
    return;
  }

  // Automatic start when level falls to lowLevelThreshold or below
  if (!currentPumpState && (levelPercent <= (int)lowLevelThreshold)) {
    if (now - lastPumpStopTime >= PUMP_MIN_OFF_TIME) {
      currentPumpState = true;
      logSystemEvent(
          "Pump Controller",
          "Pump started automatically. Water level: " + String(levelPercent) +
              "% fell to low level threshold (" +
              String((int)lowLevelThreshold) +
              "%). Reason: Low water level refill triggered.",
          LEVEL_INFO);
      updateFirebasePumpState(true);
    } else {
      DEBUG_PRINTF(
          "[Pump] Auto-start pending anti-chatter cooldown (%lus remaining)\n",
          (PUMP_MIN_OFF_TIME - (now - lastPumpStopTime)) / 1000);
    }
  }
}

// ==========================================
// Historical Telemetry Sampling (every 10 mins)
// ==========================================
const unsigned long HISTORY_SAMPLE_INTERVAL = 600000UL;
unsigned long lastHistorySampleTime = 0;

void postHistorySample() {
  if (!isNetworkConnected())
    return;
  if (!ensureFirebaseAuth())
    return;

  // Snapshot sensor data under mutex
  int lvlPercent;
  float lvlHeight, phVal;
  bool lvlOk, phOk;
  bool pumpOn;
  if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
    lvlPercent = stabilizedWaterLevelPercent;
    lvlHeight = stabilizedWaterHeight;
    phVal = stabilizedPhValue;
    lvlOk = levelSensorOk;
    phOk = phSensorOk;
    pumpOn = currentPumpState;
    xSemaphoreGive(sensorDataMutex);
  } else {
    return;
  }

  if (!lvlOk && !phOk) {
    DEBUG_PRINTLN("[History] Both sensors faulty. Skipping history sample.");
    return;
  }

  String jsonPayload;
  jsonPayload.reserve(256);

  jsonPayload = "{";
  if (lvlOk && lvlPercent != -999) {
    jsonPayload += "\"waterLevel\":" + String(lvlPercent) + ",";
    jsonPayload += "\"waterHeight\":" + String(lvlHeight, 2) + ",";
  } else {
    jsonPayload += "\"waterLevel\":null,";
    jsonPayload += "\"waterHeight\":null,";
  }

  if (phOk && phVal != -999.0) {
    jsonPayload += "\"phLevel\":" + String(phVal, 2) + ",";
  } else {
    jsonPayload += "\"phLevel\":null,";
  }

  jsonPayload += "\"pumpOn\":" + String(pumpOn ? "true" : "false") + ",";
  jsonPayload += "\"timestamp\":{\".sv\":\"timestamp\"}";
  jsonPayload += "}";

  WiFiClientSecure secureClient;
  secureClient.setInsecure();
  HTTPClient http;
  http.begin(secureClient, getHistoryUrl());
  http.setTimeout(2000);
  http.addHeader("Content-Type", "application/json");

  int httpResponseCode = http.sendRequest("POST", jsonPayload);
  if (httpResponseCode == 401) {
    DEBUG_PRINTLN("[FirebaseAuth] Received 401 Unauthorized in history post. "
                  "Invalidating token.");
    firebaseAuthValid = false;
  } else if (httpResponseCode >= 200 && httpResponseCode < 300) {
    DEBUG_PRINTF("[History] Sample successfully posted to /history/tanks/%d.\n",
                 TANK_ID);
  } else {
    DEBUG_PRINTF("[History] Failed to post history sample. HTTP Code: %d\n",
                 httpResponseCode);
  }
  http.end();
}

// =================================================================================
// SENSOR TASK  (Core 1)
// Handles: sensor sampling, stabilization, spike rejection, relay driving,
//          alert state machine.
// This task NEVER touches WiFi, HTTP, or Firebase so it runs uninterrupted.
// =================================================================================
void sensorTask(void *pvParameters) {
  esp_task_wdt_add(NULL); // Subscribe to hardware watchdog

  Serial.println("[SensorTask] Started on Core " + String(xPortGetCoreID()));

  // Pre-fill filter buffers
  for (int i = 0; i < FILTER_MEDIAN_WINDOW; i++) {
    levelRawSamples[i] = (analogRead(LEVEL_SENSOR_PIN) / 4095.0) * 3.3;
    phRawSamples[i] = (analogRead(PH_SENSOR_PIN) / 4095.0) * 3.3;
    vTaskDelay(pdMS_TO_TICKS(10));
  }
  levelBufferFilled = true;
  phBufferFilled = true;

  unsigned long lastProcessTime = 0;

  for (;;) {
    esp_task_wdt_reset(); // Pet the watchdog

    // 1. Sample raw ADC values every 20 ms
    sampleSensorsNonBlocking();

    // 2. Every 200 ms: run full processing pipeline
    unsigned long now = millis();
    if (now - lastProcessTime >= SENSOR_PROCESSING_INTERVAL) {
      lastProcessTime = now;

      processPhSensor();
      processLevelSensor();

      // Snapshot current values for alert evaluation
      int lvlPct;
      float phV;
      if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(5)) == pdTRUE) {
        lvlPct = stabilizedWaterLevelPercent;
        phV = stabilizedPhValue;
        xSemaphoreGive(sensorDataMutex);
      } else {
        vTaskDelay(pdMS_TO_TICKS(1));
        continue;
      }

      // Alert state machine
      bool isLowAbnormal = (lowLevelAlert.state == STATE_NORMAL)
                               ? (lvlPct < lowLevelThreshold)
                               : !(lvlPct >= (lowLevelThreshold + 2.0));

      bool isHighAbnormal = (highLevelAlert.state == STATE_NORMAL)
                                ? (lvlPct > overflowThreshold)
                                : !(lvlPct <= (overflowThreshold - 2.0));

      bool isPhAbnormal =
          (phAlert.state == STATE_NORMAL)
              ? (phV < minPh || phV > maxPh)
              : !(phV >= (minPh + 0.15) && phV <= (maxPh - 0.15));

      updateAlertState(lowLevelAlert, isLowAbnormal,
                       "Water level is extremely low: " + String(lvlPct) + "%");
      updateAlertState(
          highLevelAlert, isHighAbnormal,
          "Water level is reaching overflow capacity: " + String(lvlPct) + "%");
      updateAlertState(phAlert, isPhAbnormal,
                       "Unsafe pH level detected: " + String(phV, 2));

      // Drive relay directly with no network dependency
      bool desiredPumpState = currentPumpState;
      if (desiredPumpState != lastActualPumpState) {
        digitalWrite(RELAY_PIN, desiredPumpState ? HIGH : LOW);
        lastActualPumpState = desiredPumpState;
      }
    }

    vTaskDelay(pdMS_TO_TICKS(5)); // Yield to other tasks
  }
}

// =================================================================================
// NETWORK TASK  (Core 0)
// Handles: WiFi/Ethernet management, Firebase auth, command polling,
//          sensor upload, config sync, history posting, RAM log flushing.
// All blocking TLS/HTTP calls live here, away from the sensor loop.
// =================================================================================
void networkTask(void *pvParameters) {
  esp_task_wdt_add(NULL); // Subscribe to hardware watchdog

  Serial.println("[NetworkTask] Started on Core " + String(xPortGetCoreID()));

  static bool lastSentPhHealth = true;
  static bool lastSentLevelHealth = true;

  for (;;) {
    esp_task_wdt_reset(); // Pet the watchdog

    // 0. Deferred work from WiFi/ETH event callbacks
    processDeferredNetworkWork();

    // 1. Manage WiFi reconnection
    manageConnections();

    // 2. Network watchdog: zombie socket detector
    checkNetworkWatchdog();

    // 3. Low-heap guard
    {
      uint32_t freeHeap = ESP.getFreeHeap();
      DEBUG_PRINTF("[Heap] Free: %u bytes\n", freeHeap);
      if (freeHeap < MINIMUM_SAFE_HEAP && commandClientConfigured) {
        Serial.printf(
            "[HeapGuard] Free heap (%u B) below safe threshold (%u B). "
            "Resetting TLS client to prevent allocation failure.\n",
            freeHeap, MINIMUM_SAFE_HEAP);
        commandClient.stop();
        commandClientConfigured = false;
      }
    }

    // 4. Proactively refresh Firebase auth token
    if (isNetworkConnected()) {
      ensureFirebaseAuth();
    }

    // 5. Flush offline-buffered logs on reconnect
    if (isNetworkConnected() && firebaseConnected && ramLogCount > 0) {
      flushRamLogBuffer();
    }

    // 6. Automatic pump control decision (calls Firebase if state changes)
    processAutomaticPumpControl();

    // =============================================================
    // 7. CONSOLIDATED COMMAND POLLING (READS from Firebase)
    // =============================================================
    if (isNetworkConnected() &&
        (millis() - lastCommandPoll >= currentCommandPollInterval)) {
      lastCommandPoll = millis();
      unsigned long pollStartTime = millis();

      if (ensureFirebaseAuth()) {
        if (!commandClientConfigured) {
          commandClient.setInsecure();
          commandClientConfigured = true;
        }

        HTTPClient http;
        http.setReuse(true);
        http.begin(commandClient, getTanksUrl());
        http.setTimeout(1500);
        int httpResponseCode = http.GET();

        if (httpResponseCode == 401) {
          DEBUG_PRINTLN("[FirebaseAuth] Received 401 Unauthorized in command "
                        "polling. Invalidating token.");
          firebaseAuthValid = false;
        }

        if (httpResponseCode > 0 && httpResponseCode != 401) {
          bool wasDisconnected = !firebaseConnected;
          firebaseConnected = true;
          lastFirebaseSuccessTime = millis();
          firebaseErrorCount = 0;
          currentCommandPollInterval = COMMAND_POLL_INTERVAL;

          if (wasDisconnected || ramLogCount > 0) {
            flushRamLogBuffer();
          }

          String payload = http.getString();
          payload.trim();

          bool firebasePump = getBoolFromJson(payload, "pumpOn");

          if (firebasePump != lastSentPumpState) {
            if (firebasePump) {
              // Manual ON command requested
              bool lvlOk;
              int lvlPct;
              if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(10)) ==
                  pdTRUE) {
                lvlOk = levelSensorOk;
                lvlPct = stabilizedWaterLevelPercent;
                xSemaphoreGive(sensorDataMutex);
              } else {
                lvlOk = false;
                lvlPct = 0;
              }

              if (lvlOk && lvlPct >= 0 && lvlPct >= (int)overflowThreshold) {
                DEBUG_PRINTLN(
                    "[Pump] Manual ON command refused: Water level is "
                    "at or above overflowThreshold.");
                logSystemEvent("Pump Controller",
                               "Manual pump ON command refused: Water level (" +
                                   String(lvlPct) +
                                   "%) is at or above overflow threshold (" +
                                   String((int)overflowThreshold) + "%).",
                               LEVEL_WARNING);
                updateFirebasePumpState(false);
                currentPumpState = false;
              } else if (maintenanceMode) {
                DEBUG_PRINTLN("[Pump] Manual ON command refused: Maintenance "
                              "mode is active.");
                logSystemEvent("Pump Controller",
                               "Manual pump ON command refused: Maintenance "
                               "mode is active.",
                               LEVEL_WARNING);
                updateFirebasePumpState(false);
                currentPumpState = false;
              } else if (pumpControlLock) {
                DEBUG_PRINTLN("[Pump] Manual toggle refused: Pump control lock "
                              "is enabled.");
                logSystemEvent(
                    "Pump Controller",
                    "Manual pump toggle refused: Pump control lock is enabled.",
                    LEVEL_WARNING);
                updateFirebasePumpState(currentPumpState);
              } else if (!lvlOk) {
                DEBUG_PRINTLN("[Pump] Manual ON command refused: Level sensor "
                              "is faulty.");
                logSystemEvent("Pump Controller",
                               "Manual pump ON command refused: Water level "
                               "sensor is faulty.",
                               LEVEL_CRITICAL);
                updateFirebasePumpState(false);
                currentPumpState = false;
              } else {
                currentPumpState = true;
                lastSentPumpState = true;
                logSystemEvent(
                    "Pump Controller",
                    "Manual pump ON command accepted. Water level: " +
                        String(lvlPct) + "%",
                    LEVEL_INFO);
              }
            } else {
              // Manual OFF command requested
              if (pumpControlLock) {
                DEBUG_PRINTLN("[Pump] Manual toggle refused: Pump control lock "
                              "is enabled.");
                logSystemEvent(
                    "Pump Controller",
                    "Manual pump toggle refused: Pump control lock is enabled.",
                    LEVEL_WARNING);
                updateFirebasePumpState(currentPumpState);
              } else {
                currentPumpState = false;
                lastSentPumpState = false;
                lastPumpStopTime = millis();
                logSystemEvent(
                    "Pump Controller",
                    "Manual pump OFF command accepted. Water level: " +
                        String(stabilizedWaterLevelPercent) + "%",
                    LEVEL_INFO);
              }
            }
          }

          // --- DYNAMIC CALIBRATION SYNC ---
          if (hasKeyInJson(payload, "levelVmin")) {
            float val = getFloatFromJson(payload, "levelVmin");
            if (val != -999.0)
              levelVmin = val;
          }
          if (hasKeyInJson(payload, "levelVmax")) {
            float val = getFloatFromJson(payload, "levelVmax");
            if (val != -999.0)
              levelVmax = val;
          }
          if (hasKeyInJson(payload, "tankHeight")) {
            float val = getFloatFromJson(payload, "tankHeight");
            if (val != -999.0)
              tankHeight = val;
          }
          if (hasKeyInJson(payload, "levelOffset")) {
            float val = getFloatFromJson(payload, "levelOffset");
            if (val != -999.0)
              levelOffset = val;
          }
          if (hasKeyInJson(payload, "phNeutralVoltage")) {
            float val = getFloatFromJson(payload, "phNeutralVoltage");
            if (val != -999.0)
              phNeutralVoltage = val;
          }
          if (hasKeyInJson(payload, "phSlope")) {
            float val = getFloatFromJson(payload, "phSlope");
            if (val != -999.0)
              phSlope = val;
          }
          if (hasKeyInJson(payload, "phOffset")) {
            float val = getFloatFromJson(payload, "phOffset");
            if (val != -999.0)
              phOffset = val;
          }
        } else {
          commandClient.stop();
          firebaseConnected = false;
          firebaseErrorCount++;
          currentCommandPollInterval =
              min(COMMAND_POLL_INTERVAL * (1 << min(firebaseErrorCount, 3)),
                  30000UL);

          DEBUG_PRINTF(
              "Error polling commands. HTTP Code: %d. Backing off to %lds\n",
              httpResponseCode, currentCommandPollInterval / 1000);
        }
        http.end();

        // Poll /config for dynamic system-wide alert thresholds
        HTTPClient httpConfig;
        httpConfig.setReuse(true);
        httpConfig.begin(commandClient, getConfigUrl());
        httpConfig.setTimeout(1500);
        int configResponseCode = httpConfig.GET();

        if (configResponseCode == 401) {
          DEBUG_PRINTLN("[FirebaseAuth] Received 401 Unauthorized in config "
                        "polling. Invalidating token.");
          firebaseAuthValid = false;
        }

        if (configResponseCode >= 200 && configResponseCode < 300) {
          String configPayload = httpConfig.getString();
          configPayload.trim();

          if (hasKeyInJson(configPayload, "lowLevelThreshold")) {
            float val = getFloatFromJson(configPayload, "lowLevelThreshold");
            if (val != -999.0)
              lowLevelThreshold = val;
          }
          if (hasKeyInJson(configPayload, "overflowThreshold")) {
            float val = getFloatFromJson(configPayload, "overflowThreshold");
            if (val != -999.0)
              overflowThreshold = val;
          }
          if (hasKeyInJson(configPayload, "minPh")) {
            float val = getFloatFromJson(configPayload, "minPh");
            if (val != -999.0)
              minPh = val;
          }
          if (hasKeyInJson(configPayload, "maxPh")) {
            float val = getFloatFromJson(configPayload, "maxPh");
            if (val != -999.0)
              maxPh = val;
          }
          if (hasKeyInJson(configPayload, "maintenanceMode")) {
            maintenanceMode = getBoolFromJson(configPayload, "maintenanceMode");
          }
          if (hasKeyInJson(configPayload, "pumpControlLock")) {
            pumpControlLock = getBoolFromJson(configPayload, "pumpControlLock");
          }
        } else {
          if (configResponseCode <= 0) {
            commandClient.stop();
          }
          DEBUG_PRINTF(
              "Config read failed (HTTP %d). Falling back to last known "
              "thresholds (%.1f/%.1f/%.2f/%.2f)\n",
              configResponseCode, lowLevelThreshold, overflowThreshold, minPh,
              maxPh);
        }
        httpConfig.end();
      }

      unsigned long pollDuration = millis() - pollStartTime;
      if (pollDuration > 1500) {
        logSystemEvent("System Performance",
                       "Command poll took longer than expected: " +
                           String(pollDuration) + "ms (Limit: 1500ms)",
                       LEVEL_WARNING);
      }
    }

    // =============================================================
    // 8. CONDITIONAL SENSOR UPLOADS (WRITES to Firebase)
    // =============================================================

    // Snapshot shared data under mutex
    int snapLevel;
    float snapPh, snapHeight;
    bool snapPhOk, snapLevelOk;
    bool snapPumpState;
    if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
      snapLevel = stabilizedWaterLevelPercent;
      snapPh = stabilizedPhValue;
      snapHeight = stabilizedWaterHeight;
      snapPhOk = phSensorOk;
      snapLevelOk = levelSensorOk;
      snapPumpState = currentPumpState;
      xSemaphoreGive(sensorDataMutex);
    } else {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

    bool levelChangedSignificantly =
        (lastSentWaterLevelPercent == -999) ||
        (abs(snapLevel - lastSentWaterLevelPercent) >= WATER_LEVEL_DEADBAND);
    bool phChangedSignificantly =
        (lastSentPhValue == -999.0) ||
        (abs(snapPh - lastSentPhValue) >= PH_LEVEL_DEADBAND);
    bool pumpStateChanged = (snapPumpState != lastSentPumpState);
    bool phHealthChanged = (snapPhOk != lastSentPhHealth);
    bool levelHealthChanged = (snapLevelOk != lastSentLevelHealth);
    bool alertStateChanged =
        (lowLevelAlert.state != lastSentLowLevelAlertState) ||
        (highLevelAlert.state != lastSentHighLevelAlertState) ||
        (phAlert.state != lastSentPhAlertState);
    bool heartbeatElapsed =
        (millis() - lastSensorWrite >= SENSOR_WRITE_HEARTBEAT);
    bool rateLimitElapsed = (millis() - lastSensorWrite >= MIN_WRITE_INTERVAL);

    if (isNetworkConnected()) {
      if (rateLimitElapsed &&
          (levelChangedSignificantly || phChangedSignificantly ||
           pumpStateChanged || phHealthChanged || levelHealthChanged ||
           alertStateChanged || heartbeatElapsed)) {
        if (ensureFirebaseAuth()) {

          // Compute overall status from alert states
          String status = "safe";
          if (lowLevelAlert.state == STATE_CRITICAL ||
              phAlert.state == STATE_CRITICAL) {
            status = "danger";
          } else if (highLevelAlert.state == STATE_WARNING) {
            status = "warning";
          }

          String jsonPayload;
          jsonPayload.reserve(512);

          jsonPayload = "{";
          jsonPayload += "\"waterLevel\":" + String(snapLevel) + ",";
          jsonPayload += "\"phLevel\":" + String(snapPh, 2) + ",";
          jsonPayload += "\"waterHeight\":" + String(snapHeight, 2) + ",";
          jsonPayload += "\"status\":\"" + status + "\",";
          jsonPayload +=
              "\"pumpOn\":" + String(snapPumpState ? "true" : "false") + ",";
          jsonPayload +=
              "\"phSensorOk\":" + String(snapPhOk ? "true" : "false") + ",";
          jsonPayload +=
              "\"levelSensorOk\":" + String(snapLevelOk ? "true" : "false") +
              ",";
          jsonPayload += "\"lowLevelAlert\":\"" +
                         getAlertStateStr(lowLevelAlert.state) + "\",";
          jsonPayload += "\"highLevelAlert\":\"" +
                         getAlertStateStr(highLevelAlert.state) + "\",";
          jsonPayload +=
              "\"phAlert\":\"" + getAlertStateStr(phAlert.state) + "\",";
          jsonPayload += "\"rssi\":" + String(WiFi.RSSI()) + ",";
          jsonPayload +=
              "\"wifiConnected\":" + String(wifiConnected ? "true" : "false") +
              ",";
          jsonPayload += "\"firebaseConnected\":" +
                         String(firebaseConnected ? "true" : "false") + ",";
          jsonPayload +=
              "\"ethConnected\":" + String(ethConnected ? "true" : "false") +
              ",";
          jsonPayload += "\"lastUpdate\":{\".sv\":\"timestamp\"}";
          jsonPayload += "}";

          WiFiClientSecure secureClient;
          secureClient.setInsecure();
          HTTPClient http;
          http.begin(secureClient, getTanksUrl());
          http.setTimeout(1500);
          http.addHeader("Content-Type", "application/json");

          int httpResponseCode = http.sendRequest("PATCH", jsonPayload);
          if (httpResponseCode == 401) {
            DEBUG_PRINTLN("[FirebaseAuth] Received 401 Unauthorized in sensor "
                          "upload. Invalidating token.");
            firebaseAuthValid = false;
          }

          if (httpResponseCode > 0 && httpResponseCode != 401) {
            DEBUG_PRINTLN("Firebase Sensors Updated successfully.");
            bool wasDisconnected = !firebaseConnected;
            if (wasDisconnected) {
              logSystemEvent(
                  "Firebase Recovery",
                  "Firebase live sensor connection successfully restored.",
                  LEVEL_INFO);
            }
            firebaseConnected = true;
            lastFirebaseSuccessTime = millis();
            firebaseErrorCount = 0;
            currentCommandPollInterval = COMMAND_POLL_INTERVAL;

            if (wasDisconnected || ramLogCount > 0) {
              flushRamLogBuffer();
            }

            lastSentPumpState = snapPumpState;
            lastSentWaterLevelPercent = snapLevel;
            lastSentPhValue = snapPh;
            lastSentWaterHeight = snapHeight;
            lastSentPhHealth = snapPhOk;
            lastSentLevelHealth = snapLevelOk;
            lastSentLowLevelAlertState = lowLevelAlert.state;
            lastSentHighLevelAlertState = highLevelAlert.state;
            lastSentPhAlertState = phAlert.state;
            lastSensorWrite = millis();
          } else {
            firebaseConnected = false;
            firebaseErrorCount++;
            currentCommandPollInterval =
                min(COMMAND_POLL_INTERVAL * (1 << min(firebaseErrorCount, 3)),
                    30000UL);

            DEBUG_PRINTLN("Error Sending Data to Firebase!");
            logSystemEvent("Firebase Error",
                           "Failed to patch live sensor data. HTTP Code: " +
                               String(httpResponseCode),
                           LEVEL_ERROR);
          }
          http.end();
        }
      }
    } else if (!isNetworkConnected() &&
               millis() - lastSensorWrite > SENSOR_WRITE_HEARTBEAT) {
      lastSensorWrite = millis();
      DEBUG_PRINTLN("No Internet Connection. All remote updates failing.");
    }

    // =============================================================
    // 9. HISTORICAL TELEMETRY SAMPLING (EVERY 10 MINUTES)
    // =============================================================
    if (isNetworkConnected()) {
      if (lastHistorySampleTime == 0) {
        if (snapLevel != -999) {
          lastHistorySampleTime = millis();
          postHistorySample();
        }
      } else if (millis() - lastHistorySampleTime >= HISTORY_SAMPLE_INTERVAL) {
        lastHistorySampleTime = millis();
        postHistorySample();
      }
    }

    vTaskDelay(pdMS_TO_TICKS(10)); // Yield - prevents starvation of other tasks
  }
}

// ==========================================
// Setup
// ==========================================
void setup() {
  Serial.begin(115200);
  vTaskDelay(pdMS_TO_TICKS(1000));

  Serial.println(
      "Starting ESP32 Water Monitor System (FreeRTOS dual-core mode)...");

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);

  commandClient.setInsecure();
  commandClientConfigured = true;

  // Create the shared sensor data mutex
  sensorDataMutex = xSemaphoreCreateMutex();
  if (sensorDataMutex == NULL) {
    Serial.println("[FATAL] Failed to create sensorDataMutex!");
    while (true) {
      vTaskDelay(pdMS_TO_TICKS(1000));
    }
  }

  // Configure hardware watchdog timer.
  // If any FreeRTOS task hangs for WDT_TIMEOUT_SECONDS, the board resets.
  esp_task_wdt_config_t wdtConfig = {.timeout_ms = WDT_TIMEOUT_SECONDS * 1000,
                                     .idle_core_mask = 0,
                                     .trigger_panic = true};
  esp_task_wdt_reconfigure(&wdtConfig);

  WiFi.onEvent(WiFiEvent);

  Serial.println("Initializing WiFi Backup...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  // Disable WiFi modem sleep. This prevents the router from silently
  // deauthenticating the board after ~30 minutes of low traffic.
  WiFi.setSleep(false);

  Serial.println("Initializing Ethernet...");
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
  ETH.begin(ETH_TYPE, ETH_ADDR, ETH_MDC_PIN, ETH_MDIO_PIN, -1, ETH_CLK_MODE);
#else
  ETH.begin(ETH_ADDR, -1, ETH_MDC_PIN, ETH_MDIO_PIN, ETH_TYPE, ETH_CLK_MODE);
#endif

  // Spawn sensorTask on Core 1 (dedicated to real-time sensor work)
  xTaskCreatePinnedToCore(
      sensorTask,   // task function
      "SensorTask", // name for debugging
      10240,        // stack in bytes (expanded from 8KB for safety buffer)
      NULL,         // parameter
      2,            // priority (higher = more urgent; sensors must not starve)
      NULL,         // task handle (not needed)
      1             // CPU core 1
  );

  // Spawn networkTask on Core 0 (the "protocol CPU" which also handles WiFi
  // stack)
  xTaskCreatePinnedToCore(
      networkTask,   // task function
      "NetworkTask", // name for debugging
      20480,         // stack in bytes (TLS + HTTP needs a large stack)
      NULL,          // parameter
      1,             // priority (lower than sensorTask)
      NULL,          // task handle (not needed)
      0              // CPU core 0
  );

  Serial.println("FreeRTOS tasks launched. System Ready.");

  // Arduino's loop() task runs on Core 1 at priority 1.
  // We don't use it, so delete it to free 8KB of stack memory.
  vTaskDelete(NULL);
}

// loop() is intentionally left empty.
// All work is done in the FreeRTOS tasks above.
void loop() {}
