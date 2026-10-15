<p align="center">
  <img src="frontend/public/favicon.svg" width="64" alt="MSU Water Monitoring System Logo" />
</p>

<h1 align="center">MSU Water Monitoring & Control System</h1>

<p align="center">
  An IoT-based real-time water level and pH monitoring system built for Mindanao State University reservoir infrastructure.
  <br/>
  <strong>ESP32 Edge Node · Firebase Backend · React Web Dashboard · Android Mobile App</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-ESP32-blue?logo=espressif" />
  <img src="https://img.shields.io/badge/Frontend-React%2018%20%2B%20TypeScript-61DAFB?logo=react" />
  <img src="https://img.shields.io/badge/Backend-Firebase%20RTDB%20%2B%20Firestore-FFCA28?logo=firebase" />
  <img src="https://img.shields.io/badge/Mobile-Android%20(Capacitor%208)-3DDC84?logo=android" />
  <img src="https://img.shields.io/badge/Build-Vite-646CFF?logo=vite" />
  <img src="https://img.shields.io/badge/Tests-Vitest%20(37%20passed)-green?logo=vitest" />
</p>

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Hardware Components & Wiring](#hardware-components--wiring)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Web Application Setup](#web-application-setup)
  - [ESP32 Firmware Setup](#esp32-firmware-setup)
  - [Android App Build](#android-app-build)
- [Signal Processing & Control Rules](#signal-processing--control-rules)
  - [4-Stage Filter Pipeline](#4-stage-filter-pipeline)
  - [Calibration Formulas](#calibration-formulas)
  - [Automatic Pump Control](#automatic-pump-control)
- [User Roles & Security](#user-roles--security)
- [Multi-Tank Infrastructure & Limitations](#multi-tank-infrastructure--limitations)
- [License](#license)

---

## Overview

The **MSU Water Monitoring & Control System** is a full-stack IoT platform for automating the monitoring and control of university water reservoirs. An ESP32 microcontroller edge node deployed at the reservoir site continuously samples water level and pH sensors, applies digital filtering, manages pump relays, and streams telemetry to Firebase in real time. Operators and administrators access a responsive web dashboard or native Android app to view live telemetry, trigger manual overrides, adjust remote calibrations, audit event logs, and export multi-format reports.

---

## System Architecture

```
┌────────────────────────────────────────────────────────┐
│               Edge Layer (ESP32 Node)                  │
│                                                        │
│  Hydrostatic Level (GPIO 35) ──┐                       │
│  pH Glass Electrode (GPIO 34) ─┼──► ESP32 MCU ────────► Firebase RTDB
│  Relay Actuator (GPIO 32)   ◄──┘        │              │
└─────────────────────────────────────────┼──────────────┘
                                          │
                         ┌────────────────┴───────────────┐
                         │          Cloud Layer           │
                         │  Firebase Realtime Database    │
                         │  Cloud Firestore (Users/Auth)  │
                         └────────────────┬───────────────┘
                                          │
                         ┌────────────────┴───────────────┐
                         │          Client Layer          │
                         │  React 18 SPA (Web Dashboard)  │
                         │  Capacitor 8 Native App        │
                         └────────────────────────────────┘
```

The ESP32 communicates with Firebase via **Ethernet (LAN8720, primary)** or **Wi-Fi 2.4GHz (backup/failover)**, automatically switching interfaces with an integrated 90-second zombie-socket watchdog.

---

## Features

**Real-Time Telemetry**
- Live water level display as percentage (0–100%) and physical depth in meters
- Live pH reading with color-coded classification (Acidic / Neutral / Alkaline)
- Electrical sensor health diagnostics (detects open circuit $V \le 0.05\text{V}$ and short circuit $V \ge 3.25\text{V}$)
- Connection telemetry: Ethernet/Wi-Fi link state, RSSI signal strength in dBm, and last update timestamp

**Automated Pump Protection**
- Automatic refill trigger when water level drops to $\le 15\%$ (`lowLevelThreshold`)
- Automatic overflow shutoff when level reaches $\ge 95\%$ (`overflowThreshold`)
- 30-second anti-chatter minimum OFF cooldown (`PUMP_MIN_OFF_TIME = 30000ms`) to protect pump motors
- Emergency pump interlocks: automatic shutdown on sensor fault or Maintenance Mode activation

**Remote Sensor Calibration**
- Calibration parameters ($V_{min}$, $V_{max}$, tank height, level offset, $V_{neutral}$, pH slope, pH offset) configurable via the Admin Panel
- Real-time synchronization to the ESP32 node via Firebase RTDB ($\le 1\text{s}$) without recompiling firmware

**User Management & Security**
- Role-Based Access Control (RBAC): **Administrator**, **Worker**, and **Viewer**
- Admin panel for creating, updating, and enabling/disabling operator profiles
- Firestore security rules protecting user data, and RTDB rules protecting telemetry and config

**Reports & Historical Analytics**
- 10-minute automated historical telemetry logging (`/history/tanks/1`)
- Interactive Recharts visualization (Area, Line, Bar, and Pie distributions)
- Multi-format data exports: **Excel (.xlsx)** via `exceljs`, **PDF (.pdf)** via `jspdf` & `jspdf-autotable`, and **CSV (.csv)**, plus browser printing
- Audit log viewer with severity tags (`INFO`, `WARNING`, `ERROR`, `CRITICAL`) and RAM offline buffering

---

## Tech Stack

| Layer | Technology |
|---|---|
| Microcontroller | ESP32 Dev Module (Dual-core Xtensa LX6 @ 240MHz, FreeRTOS) |
| Connectivity | LAN8720 Ethernet PHY (RMII) + 2.4GHz Wi-Fi (dual failover) |
| Cloud Database | Firebase Realtime Database (RTDB) |
| Auth & Profiles | Firebase Authentication + Cloud Firestore |
| Frontend | React 18, TypeScript, Vite |
| UI Components | shadcn/ui, Radix UI, Tailwind CSS, Lucide Icons |
| Charts | Recharts |
| Mobile | Capacitor 8 (Android) |
| Testing | Vitest (37 passing automated tests) |
| Hosting | Firebase Hosting |

---

## Hardware Components & Wiring

| Component | ESP32 Pin | Purpose | Specifications |
|---|---|---|---|
| **ESP32 Dev Module** | Core Controller | Central processing & networking | Dual-Core 240MHz, FreeRTOS, 520KB SRAM |
| **LAN8720 Ethernet PHY** | MDC: GPIO 23<br/>MDIO: GPIO 18<br/>CLK: GPIO 17 | Primary wired local network | RMII mode, 50MHz oscillator output |
| **Hydrostatic Level Sensor** | GPIO 35 (ADC1_CH7) | Submersible water level measurement | Analog DC voltage (0.25V empty – 3.00V full), input-only pin |
| **pH Glass Electrode Module** | GPIO 34 (ADC1_CH6) | Hydrogen-ion concentration | Analog DC voltage (2.50V @ pH 7.00, 0.18V/pH slope), input-only pin |
| **Relay Module (5V)** | GPIO 32 | 220V AC pump power switching | Optocoupled, Active-HIGH trigger, 30s anti-chatter cooldown |

> [!NOTE]
> **Controller Architecture**: The operational edge controller is strictly the **ESP32 Dev Module**. *(Orange Pi One: Not implemented / TO CONFIRM as an unadopted edge gateway).* No servo motor or mechanical valve is used; pump control is executed solely via the 5V relay module on GPIO 32.

---

## Project Structure

```
MSU-WATER-MONITORING-SYSTEM/
├── frontend/                   # React SPA web application (Vite + TypeScript)
│   ├── public/                 # Static assets (logos, favicon)
│   ├── src/                    # Source components, pages, context, and store
│   │   ├── components/         # Reusable UI components (WaterGauge, AppLayout)
│   │   ├── config/             # Firebase SDK client initialization
│   │   ├── context/            # AuthContext and state providers
│   │   ├── hooks/              # Custom React hooks (useAuth, useUIStabilization)
│   │   ├── lib/                # Utility helpers (utils.ts)
│   │   ├── pages/              # Views (Dashboard, AdminPanel, Reports, Logs, Login)
│   │   ├── routes/             # App routing configuration
│   │   ├── services/           # Authentication and business logic services
│   │   ├── store/              # Centralized state store (useStore.ts)
│   │   └── test/               # Vitest test suites (37 passing unit tests)
│   ├── index.html              # HTML entrypoint
│   ├── vite.config.ts          # Bundler configuration
│   ├── vitest.config.ts        # Test runner configuration
│   ├── tailwind.config.ts      # Tailwind design system styling
│   └── package.json            # Frontend-specific scripts
├── backend/                    # Cloud rules and microcontroller edge firmware
│   ├── cloud/                  # Firebase RTDB & Firestore security rules
│   │   ├── database.rules.json # Realtime Database security rules
│   │   └── firestore.rules     # Firestore security rules
│   └── firmware/               # Microcontroller firmware
│       ├── esp32_firmware.ino  # FreeRTOS dual-core C++ Arduino firmware
│       ├── secrets.h           # Device Wi-Fi and Firebase credentials (untracked)
│       └── secrets.example.h   # Credentials template
├── mobile/                     # Cross-platform mobile project
│   ├── android/                # Capacitor-generated Android native project
│   └── capacitor.config.ts     # Capacitor cross-platform configuration
├── docs/                       # Project specifications & architecture documentation
│   ├── Methodology.md          # 4-stage filtering, calibration math, and database schemas
│   ├── SRS.md                  # Software Requirements Specification
│   └── System_Overview.md      # Architecture overview, setup guide, and operator manual
├── firebase.json               # Root Firebase deployment configuration
├── package.json                # Root package runners (build, dev, test, cap:sync)
└── README.md                   # Project overview and quick-start guide
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18.0.0 or higher
- [Arduino IDE](https://www.arduino.cc/en/software) 2.x with ESP32 Board Support
- [Android Studio](https://developer.android.com/studio) (optional, for compiling Capacitor Android APK)
- A Firebase project with Realtime Database, Firestore, and Authentication enabled

### Web Application Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/MSU-WATER-MONITORING-SYSTEM.git
   cd MSU-WATER-MONITORING-SYSTEM
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Firebase by editing `frontend/src/config/firebase.ts` with your credentials:
   ```ts
   export const firebaseConfig = {
     apiKey: "YOUR_API_KEY",
     authDomain: "YOUR_PROJECT.firebaseapp.com",
     databaseURL: "https://YOUR_PROJECT-default-rtdb.firebasedatabase.app",
     projectId: "YOUR_PROJECT",
     storageBucket: "YOUR_PROJECT.appspot.com",
     messagingSenderId: "YOUR_SENDER_ID",
     appId: "YOUR_APP_ID"
   };
   ```

4. Start the local development server:
   ```bash
   npm run dev
   ```
   The application binds to `http://localhost:8080`.

5. Run automated unit tests:
   ```bash
   npm test
   ```

6. Build and deploy to Firebase Hosting:
   ```bash
   npm run build
   firebase deploy
   ```

### ESP32 Firmware Setup

1. Open `backend/firmware/esp32_firmware.ino` in the Arduino IDE.
2. In Board Manager, select **ESP32 Dev Module**.
3. **No external third-party Arduino libraries are needed** (the firmware uses native ESP32 core libraries: `WiFi`, `WiFiClientSecure`, `HTTPClient`, `ETH`, `esp_task_wdt`, `FreeRTOS`).
4. Copy `backend/firmware/secrets.example.h` to `backend/firmware/secrets.h` and provide your network and Firebase Auth credentials:
   ```cpp
   #define WIFI_SSID "Your_WiFi_SSID"
   #define WIFI_PASSWORD "Your_WiFi_Password"
   #define FIREBASE_API_KEY "Your_Firebase_API_Key"
   #define FIREBASE_AUTH_EMAIL "esp32-device@your-domain.edu"
   #define FIREBASE_AUTH_PASSWORD "Your_Password"
   ```
5. Connect your ESP32 board via USB, choose the COM port, and click **Upload**.

### Android App Build

1. Build the production web bundle:
   ```bash
   npm run build
   ```

2. Sync web assets to the native Android project:
   ```bash
   npm run cap:sync
   ```

3. Open Android Studio:
   ```bash
   npm run cap:open
   ```

4. Build and deploy the APK to a connected Android device or emulator (Android 8.0 / API 26 minimum).

---

## Signal Processing & Control Rules

### 4-Stage Filter Pipeline

```
Analog Pin → [Stage 1: Median Filter] → [Stage 2: Moving Average]
           → [Stage 3: Bounds Validation & Spike Rejection]
           → [Stage 4: Deadband Filter] → Firebase RTDB
```

* **Execution Rate**: ADC is sampled every **20ms** (`SENSOR_SAMPLE_INTERVAL = 20ms`), and processed every **200ms** (`SENSOR_PROCESSING_INTERVAL = 200ms`).
* **Stage 1 (Median Filter)**: Rolling 5-element buffer (`FILTER_MEDIAN_WINDOW = 5`) is sorted to extract the median, discarding high/low transient spikes.
* **Stage 2 (Moving Average)**: 10-element circular buffer (`FILTER_AVERAGE_WINDOW = 10`) calculates the arithmetic mean to suppress high-frequency ripple.
* **Stage 3 (Bounds & Spikes)**: Voltages outside `0.05V–3.25V` trigger a 10-second fault confirmation timer (`SENSOR_FAULT_TIMEOUT = 10000ms`). Step changes exceeding $\Delta\text{pH} \ge 1.50$ or $\Delta\text{Level} \ge 15\%$ require 15 consecutive samples (`STABILIZATION_SAMPLES = 15`) to confirm.
* **Stage 4 (Deadband Filter)**: Telemetry is only pushed to Firebase when readings shift by at least **2%** (water level) or **0.15 pH units**, or upon reaching the 10-second heartbeat.

### Calibration Formulas

**Water Level:**
```
Height (m)  = ((V_raw - V_min) / (V_max - V_min)) × Tank Height
Level (%)   = Clamp((Height / Tank Height) × 100 + Offset, 0, 100)
```
*Defaults: $V_{min} = 0.25\text{V}$, $V_{max} = 3.00\text{V}$, Tank Height = $5.00\text{m}$, Offset = $0.00\%$.*

**pH Level:**
```
pH = 7.0 + ((V_neutral - V_raw) / Slope) + Offset
```
*Defaults: $V_{neutral} = 2.50\text{V}$, Slope = $0.18\text{V/pH}$, Offset = $0.00$.*

### Automatic Pump Control

* **Auto-Start (Refill)**: Activates pump relay when water level $\le 15\%$ (`lowLevelThreshold`), subject to a 30-second anti-chatter cooldown (`PUMP_MIN_OFF_TIME = 30000ms`).
* **Auto-Stop (Overflow)**: Shuts off pump relay when water level reaches $\ge 95\%$ (`overflowThreshold`).
* **Emergency Interlocks**: The pump is forced OFF immediately if `maintenanceMode == true` or if `levelSensorOk == false`.

---

## User Roles & Security

| Role | Telemetry | Controls | Reports & Logs | Admin Config |
|---|:---:|:---:|:---:|:---:|
| **Administrator** | Full Access | Full Access | View & Export | Full Access (Users, Calibrations, Thresholds, Locks) |
| **Worker** | Full Access | Manual Override (unless locked) | View & Export | Read-Only |
| **Viewer** | Read-Only | No Access | No Access | No Access |
| **Super-Admin** | *Planned* | *Planned* | *Planned* | *Planned (Hierarchical admin protection via Cloud Functions)* |

* **Firestore Security Rules**: Only authenticated Administrators (`role == 'admin'`) can create, delete, or modify user roles.
* **Realtime Database Security Rules**: Read/write access to `/tanks`, `/config`, `/notifications`, `/logs`, and `/history` requires `auth != null`.

---

## Multi-Tank Infrastructure & Limitations

- **Physical Prototype Node (Tank 1)**: Reservoir Tank 1 is the active physical deployment wired to the ESP32 edge node.
- **Expansion Nodes (Tanks 2–4)**: Tanks 2, 3, and 4 are pre-configured in the database and displayed in the frontend with a **"Planned - IoT node not yet installed"** badge and `--` values until telemetry nodes are installed.
- **Dynamic Plug-and-Play Node Discovery**: *Planned / Not Implemented*. The current firmware targets `TANK_ID = 1`. Expanding to additional tanks requires flashing separate ESP32 units with corresponding IDs (`TANK_ID = 2`, etc.).
- **User Account Purging**: Deleting an operator from the Admin Panel deletes their Firestore profile and disables session access. Purging their core Firebase Auth identity entirely requires a backend Cloud Function using the Firebase Admin SDK.

---

## License

This project was developed for academic and institutional deployment at **Mindanao State University**. See `LICENSE` for terms or contact the repository administrators for institutional licensing inquiries.
