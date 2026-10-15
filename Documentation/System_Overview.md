# MSU Water Monitoring System - General Overview

Welcome to the comprehensive developer and operator documentation for the **Mindanao State University (MSU) Water Monitoring & Control System**. This system provides a unified IoT-enabled platform for real-time water level and pH telemetry monitoring, automatic pump control, remote calibration, and administrative logging.

---

## 1. System Architecture & Components

The platform consists of three main systems operating in unison:

```mermaid
graph TD
    subgraph Edge Layer (Microcontroller)
        ESP32[ESP32 MCU Node]
        LevelSensor[Hydrostatic Level Sensor] -->|Analog Voltage| ESP32
        pHSensor[pH Sensor Module] -->|Analog Voltage| ESP32
        Relay[Relay Switch] <-->|Pump Command| ESP32
    end

    subgraph Cloud Layer (Firebase Backend)
        RTDB[(Firebase Realtime Database)]
        Firestore[(Cloud Firestore)]
    end

    subgraph Client Layer (Cross-Platform Frontend)
        WebApp[React Vite SPA]
        MobileApp[Capacitor Native App]
    end

    ESP32 <-->|Secure HTTP & WebSockets| RTDB
    RTDB <-->|onValue Live Subscriptions| WebApp
    RTDB <-->|onValue Live Subscriptions| MobileApp
    Firestore <-->|User Profile & Auth Data| WebApp
    Firestore <-->|User Profile & Auth Data| MobileApp
```

### 1.1 Edge Hardware Node (ESP32)
The physical core of the monitoring system is powered by an ESP32 microcontroller, deployed at the physical reservoir site. It is equipped with:
*   **Hydrostatic Water Level Sensor**: Measures pressure-induced voltage to calculate water volume.
*   **pH Glass Electrode Sensor**: Measures hydrogen-ion concentration to monitor acidity.
*   **Relay Controller**: Drives the 220V physical water pump actuator.
*   **Network Hardware**: Connects via on-board Ethernet (primary) or Wi-Fi (backup/failover).

### 1.2 Database & Backend (Firebase)
*   **Firebase Realtime Database (RTDB)**: Serves as the primary message bus. Sub-second read/write events synchronize the physical ESP32 state with the React and mobile client interfaces.
*   **Cloud Firestore**: Handles slower, structured data such as role-based user accounts, operator credentials, and job designations.
*   **Firebase Hosting**: Hosts the compiled single-page React app at [https://msu-water-monitoring-system.web.app](https://msu-water-monitoring-system.web.app).

### 1.3 Client Dashboard Application
*   **React (Vite + TypeScript)**: A modern web application providing real-time SVG charts, status gauges, calibration inputs, administrative panels, and logs.
*   **Capacitor (Android Wrapper)**: Wraps the React web bundle to compile a native Android application. It utilizes the same codebase and communicates directly with Firebase, ensuring instant updates across all clients.

---

## 2. Directory Structure

Below is the directory map of the MSU Water Monitoring System project:

```text
MSU-WATER-MONITORING-SYSTEM/
├── android/                   # Capacitor-generated Android native project files
├── Documentation/             # System documentation, SRS, and Methodology files
│   ├── Methodology.md         # Algorithms, calibration formulas, and design system
│   ├── SRS.md                 # Software Requirements Specification
│   └── System_Overview.md     # Setup, project architecture, and operators manual
├── esp32_firmware/            # Microcontroller source code
│   └── esp32_firmware.ino     # Main C++ firmware loop, sensors filtering & RTDB client
├── public/                    # Static assets (logos, icons)
├── src/                       # Frontend source folder
│   ├── components/            # Reusable UI components (AppLayout, ProtectedRoute)
│   ├── config/                # Firebase initialization and SDK configs
│   ├── context/               # Auth and UI context hooks
│   ├── hooks/                 # custom React state hooks
│   ├── lib/                   # Utility libraries (Shadcn configurations)
│   ├── pages/                 # Full view layouts (Dashboard, AdminPanel, Reports, Logs)
│   ├── routes/                # Application page routing
│   ├── services/              # Authentication and business logic services
│   ├── store/                 # Zustand-like custom hooks for Firebase listeners
│   └── test/                  # Automated verification and Vitest files
├── capacitor.config.ts        # Capacitor cross-platform build configuration
├── tailwind.config.ts         # Style tokens, colors, transitions and spacing
├── vite.config.ts             # Vite server bindings, aliases and compilation environment
└── package.json               # Frontend dependencies and npm scripts configuration
```

---

## 3. Setup & Development Guide

### 3.1 Prerequisite Installations
Ensure the following tools are installed on your workstation:
*   [Node.js](https://nodejs.org/) (v18.0.0 or higher)
*   [Arduino IDE](https://www.arduino.cc/en/software) (for ESP32 programming)
*   [Android Studio](https://developer.android.com/studio) (for compiling Capacitor to APK)

### 3.2 Setting Up the Web Application
1.  Navigate to the repository root directory in your terminal:
    ```bash
    cd c:\Zailanor\Projects\MSU-WATER-MONITORING-SYSTEM
    ```
2.  Install all required npm dependencies:
    ```bash
    npm install
    ```
3.  Launch the local development server:
    ```bash
    npm run dev
    ```
    The web console will bind to `http://localhost:8080` (or your local IP address `http://192.168.x.x:8080`).

### 3.3 Flashing the ESP32 Node
1.  Open [esp32_firmware.ino](file:///c:/Zailanor/Projects/MSU-WATER-MONITORING-SYSTEM/esp32_firmware/esp32_firmware.ino) in the Arduino IDE.
2.  Install the required ESP32 hardware boards and library dependencies:
    *   **ESP32 Board Pack** (v2.x or v3.x)
    *   **Firebase Arduino Client** (by Mobizt)
    *   **ArduinoJson** (by Benoit Blanchon)
    *   **ESP32Servo** library
3.  Configure your network credentials in the source file:
    ```cpp
    #define WIFI_SSID "Your_WiFi_SSID"
    #define WIFI_PASSWORD "Your_WiFi_Password"
    ```
4.  Plug in the ESP32 board via USB, choose the correct COM port, select `ESP32 Dev Module` as your target board, and click **Upload**.

### 3.4 Building the Mobile App (Capacitor Android)
1.  Generate the production web build:
    ```bash
    npm run build
    ```
2.  Sync the web code to the native Android platform:
    ```bash
    npx cap sync
    ```
3.  Open the project in Android Studio:
    ```bash
    npx cap open android
    ```
4.  Build the debug/release APK directly from Android Studio or deploy to a connected physical device.

---

## 4. System Operations Guide

### 4.1 How Calibration Works
Water level and pH sensors suffer from physical drift and variations in supply voltage. The system admin can calibrate them remotely via the **Admin Panel**:
1.  **Water Level Calibration**:
    *   **Vmin (Empty Voltage)**: Set this to the voltage reading of the hydrostatic sensor when the tank is completely empty (typically around `0.25V` to `0.5V`).
    *   **Vmax (Full Voltage)**: Set this to the voltage reading when the tank is full (typically `2.5V` to `3.0V`).
    *   **Height**: Set the physical height of the reservoir in meters.
2.  **pH Calibration**:
    *   **Neutral Reference Voltage**: The voltage output when the probe is in pH 7.0 buffer solution (typically `2.50V`).
    *   **Slope Sensitivity**: Voltage change per unit pH. Defaults to `0.18V/pH`.
    *   **Reading Offset**: Additional pH offset to align with hand-held digital meters.

### 4.2 System Modes
*   **Maintenance Mode**: Activating Maintenance Mode via the Admin Panel disables all pump controls and suppresses notifications system-wide. This allows physical repairs without triggering automatic pump overrides or false alarms.
*   **Pump Control Lock**: Locks all manual toggles for standard "Worker" operators, restricting pump activation rights strictly to Admins.
