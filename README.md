<p align="center">
  <img src="public/favicon.svg" width="64" alt="MSU Water Monitoring System Logo" />
</p>

<h1 align="center">MSU Water Monitoring & Control System</h1>

<p align="center">
  An IoT-based real-time water level and pH monitoring system built for Mindanao State University reservoir infrastructure.
  <br/>
  <strong>ESP32 Edge Node · Firebase Backend · React Web Dashboard · Android Mobile App</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-ESP32-blue?logo=espressif" />
  <img src="https://img.shields.io/badge/Frontend-React%20%2B%20TypeScript-61DAFB?logo=react" />
  <img src="https://img.shields.io/badge/Backend-Firebase-FFCA28?logo=firebase" />
  <img src="https://img.shields.io/badge/Mobile-Android%20(Capacitor)-3DDC84?logo=android" />
  <img src="https://img.shields.io/badge/Build-Vite-646CFF?logo=vite" />
</p>

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Hardware Components](#hardware-components)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Web Application Setup](#web-application-setup)
  - [ESP32 Firmware Setup](#esp32-firmware-setup)
  - [Android App Build](#android-app-build)
- [Signal Processing & Calibration](#signal-processing--calibration)
- [User Roles](#user-roles)
- [Known Limitations](#known-limitations)
- [License](#license)

---

## Overview

The MSU Water Monitoring & Control System is a full-stack IoT platform for automating the monitoring and control of university water reservoirs. An ESP32 microcontroller deployed at the reservoir site continuously reads water level and pH sensors, applies digital filtering, and streams telemetry to Firebase in real time. Administrators and operators access a web dashboard or Android app to view live data, control the water pump, manage users, and review historical event logs.

---

## System Architecture

```
┌──────────────────────────────────────────────┐
│           Edge Layer (ESP32 Node)            │
│                                              │
│  Hydrostatic Sensor ──┐                      │
│  pH Electrode     ────┼──► ESP32 MCU ──────► Firebase RTDB
│  Relay (Pump)     ◄───┘        │             │
└──────────────────────────────────────────────┘
                                │
               ┌────────────────┴────────────────┐
               │         Cloud Layer              │
               │  Firebase Realtime Database      │
               │  Cloud Firestore (Users/Auth)    │
               └────────────────┬────────────────┘
                                │
               ┌────────────────┴────────────────┐
               │         Client Layer             │
               │  React SPA (Web Dashboard)       │
               │  Capacitor Android App           │
               └─────────────────────────────────┘
```

The ESP32 connects to Firebase via **Ethernet (LAN8720, primary)** or **Wi-Fi 2.4GHz (backup/failover)**, automatically switching interfaces if a connection drops.

---

## Features

**Real-Time Telemetry**
- Live water level display as percentage (0–100%) and physical height in meters
- Live pH level with color-coded acidity classification (Acidic / Neutral / Alkaline)
- Sensor health diagnostics — detects open circuits and short-circuit faults
- Network telemetry: Ethernet/Wi-Fi status, signal strength (RSSI in dBm), last update timestamp

**Automated Pump Control**
- Automatic relay activation on low water level (critical threshold)
- Automatic relay shutoff on high water level (overflow warning)
- Manual pump toggle from dashboard (role-restricted)

**Alert System**
- Validated alert state machine: `NORMAL → CRITICAL/WARNING → RECOVERED`
- 5-second confirmation window before an alert is declared (prevents false alarms)
- 60-second cooldown before a persistent alert is re-logged
- Alerts tracked per tank: Low Level, High Level, Unsafe pH

**Remote Sensor Calibration**
- Calibration parameters (Vmin, Vmax, tank height, pH neutral voltage, slope, offsets) are editable from the Admin Panel
- Changes sync instantly to the ESP32 over Firebase — no reflashing required

**User Management**
- Role-based access control: Administrator, Worker, Viewer
- Admin panel for registering, editing, enabling/disabling operators
- Firebase Auth + Firestore for credential management

**Reports & Logs**
- Event log viewer with level-tagged entries (INFO / WARNING / ERROR / CRITICAL)
- Historical telemetry charts (Area, Line, Bar, Pie)
- Multi-format data export: Excel (.xlsx), PDF (.pdf), and CSV (.csv)

**Cross-Platform**
- Web app deployable to Firebase Hosting
- Same codebase compiles to a native Android APK via Capacitor

---

## Tech Stack

| Layer | Technology |
|---|---|
| Microcontroller | ESP32 (Arduino C++, FreeRTOS dual-core) |
| Connectivity | LAN8720 Ethernet + Wi-Fi (dual failover) |
| Cloud Database | Firebase Realtime Database |
| Auth & Users | Firebase Authentication + Cloud Firestore |
| Frontend | React 18, TypeScript, Vite |
| UI Components | shadcn/ui, Radix UI, Tailwind CSS |
| Charts | Recharts |
| Mobile | Capacitor 8 (Android) |
| Hosting | Firebase Hosting |

---

## Hardware Components

| Component | Purpose |
|---|---|
| ESP32 Dev Module | Main microcontroller (Dual-Core 240MHz) |
| LAN8720 Ethernet PHY | Primary wired network (MDC: GPIO23, MDIO: GPIO18) |
| Hydrostatic Water Level Sensor | Pressure-voltage water level measurement (GPIO35) |
| pH Glass Electrode Module | Hydrogen-ion concentration measurement (GPIO34) |
| Relay Module (5V) | 220V pump actuator control (GPIO32) |

---

## Project Structure

```
MSU-WATER-MONITORING-SYSTEM/
├── frontend/                   # React SPA web application (Vite + TypeScript)
│   ├── public/                 # Static assets (logos, favicon)
│   ├── src/                    # Source components, pages, context, and store
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
│       ├── secrets.h           # Device Wi-Fi and Firebase REST API keys
│       └── secrets.example.h   # Credentials template
├── mobile/                     # Cross-platform mobile project
│   ├── android/                # Capacitor-generated Android native project
│   └── capacitor.config.ts     # Capacitor cross-platform configuration
├── docs/                       # Project specifications & architecture documentation
│   ├── Methodology.md          # Signal filtering algorithms and calibration formulas
│   ├── SRS.md                  # Software Requirements Specification
│   └── System_Overview.md      # Architecture overview and operator manual
├── firebase.json               # Root Firebase deployment configuration
├── package.json                # Root package runners (build, dev, test)
└── README.md
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18.0.0 or higher
- [Arduino IDE](https://www.arduino.cc/en/software) 2.x (for ESP32 firmware)
- [Android Studio](https://developer.android.com/studio) (optional, for Android APK build)
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

3. Configure Firebase by editing `frontend/src/config/firebase.ts` with your own Firebase project credentials:
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

4. Start the development server from the repository root:
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:8080`.

5. Run automated unit tests:
   ```bash
   npm test
   ```

6. To deploy to Firebase Hosting:
   ```bash
   npm run build
   firebase deploy
   ```

### ESP32 Firmware Setup

1. Open `backend/firmware/esp32_firmware.ino` in the Arduino IDE.

2. Configure your network and Firebase Auth credentials in `backend/firmware/secrets.h` (see `secrets.example.h`):
   ```cpp
   #define WIFI_SSID "Your_WiFi_SSID"
   #define WIFI_PASSWORD "Your_WiFi_Password"
   #define FIREBASE_API_KEY "Your_Firebase_API_Key"
   #define FIREBASE_AUTH_EMAIL "esp32-device@your-domain.edu"
   #define FIREBASE_AUTH_PASSWORD "Your_Password"
   ```

3. Select **ESP32 Dev Module** as the target board, choose the correct COM port, and click **Upload**.

> **Note:** The firmware supports ESP32 Arduino Core v2.x and v3.x. The `ETH.begin()` argument order is handled automatically via a compile-time check on `ESP_IDF_VERSION`.

### Android App Build

1. Build the web bundle:
   ```bash
   npm run build
   ```

2. Sync to the Android native project:
   ```bash
   npm run cap:sync
   ```

3. Open in Android Studio:
   ```bash
   npm run cap:open
   ```

4. Build and run from Android Studio onto a connected device or emulator (Android 8.0 / API 26 minimum).

---

## Signal Processing & Calibration

Raw analog readings from the sensors go through a 4-stage pipeline inside the ESP32 before being written to Firebase:

```
Analog Pin → [Stage 1: Median Filter] → [Stage 2: Moving Average]
           → [Stage 3: Bounds Validation] → [Stage 4: Deadband Filter] → Firebase
```

**Stage 1 — Median Filter:** Samples are pushed into a rolling 5-element buffer every 20ms. The buffer is sorted and the middle value is taken, discarding high/low transient spikes.

**Stage 2 — Moving Average:** The median output is fed into a 10-sample circular average buffer, smoothing high-frequency ripple.

**Stage 3 — Bounds Validation:** Voltages outside `0.05V–3.25V` are rejected as sensor faults. pH must be within `0.0–14.0` and water height within ±0.5m of tank bounds.

**Stage 4 — Deadband Filter:** Firebase is only updated when the reading changes by at least **2%** (water level) or **0.15 pH units** — preventing unnecessary writes on stable readings.

### Calibration Formulas

**Water Level:**
```
Height (m)  = ((V_raw - V_min) / (V_max - V_min)) × Tank Height
Level (%)   = Clamp((Height / Tank Height) × 100 + Offset, 0, 100)
```

**pH:**
```
pH = 7.0 + ((V_neutral - V_raw) / Slope) + pH_Offset
```

All calibration parameters (`levelVmin`, `levelVmax`, `tankHeight`, `levelOffset`, `phNeutralVoltage`, `phSlope`, `phOffset`) are stored in Firebase and synced to the ESP32 at runtime — no reflashing needed.

---

## User Roles

| Role | Capabilities |
|---|---|
| **Administrator** | Full system access: user management, threshold configuration, tank calibration, pump control locks. |
| **Worker** | View live telemetry, view historical event logs, export reports, and control assigned pumps (unless pump lock is active). |
| **Viewer** | Read-only dashboard access. No logs, no exports, no pump controls, no configuration. |

---

## Known Limitations

- **Single-tank firmware:** The ESP32 firmware is hardcoded to `tanks/1` in Firebase. Multi-tank support exists on the frontend but requires separate firmware deployments per node.
- **User deletion:** Deleting an operator from the Admin Panel removes their Firestore profile and deactivates their session. In a client-only architecture, purging the Firebase Auth user completely requires a Cloud Function with the Firebase Admin SDK.
- **Hardware prototype:** Physical installation currently connects Reservoir Tank 1; Reservoirs 2–4 are configured as planned expansion nodes.

---

## License

This project was developed for academic and institutional use at **Mindanao State University**. See `LICENSE` for terms, or contact the repository owner for usage inquiries.
