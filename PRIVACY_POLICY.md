# Privacy Policy — MyWay GPS

**Last Updated:** August 28, 2026  
**Effective Date:** August 28, 2026  
**Hosted URL:** [https://myway-gps.web.app/privacy.html](https://myway-gps.web.app/privacy.html)

---

## 1. Overview
Welcome to **MyWay** ("we", "our", or "us"). Your privacy, family safety, and data protection are our highest priorities. This Privacy Policy details the types of personal data we collect, why we collect it, how it is secured, and your rights over your data.

> **Core Commitment:** MyWay is built strictly for family and private circle safety. We **never sell or monetize your personal or location data** to third-party data brokers, marketers, or advertisers.

---

## 2. Information We Collect

| Data Category | Specific Elements | Purpose |
| :--- | :--- | :--- |
| **Location Data** | Precise GPS coordinates, speed, heading, altitude, timestamp (Foreground & Background) | Real-time circle location sharing, arrival/departure geofence alerts, turn-by-turn navigation, emergency SOS beacon. |
| **Account Info** | Name, email address, profile picture (optional), Firebase Auth UID | User authentication, member identification within private circles, account recovery. |
| **Motion Sensors** | Accelerometer, gyroscope (Processed on-device) | Vehicular crash impact detection and safe driving HUD analytics. |
| **Circle Messages** | In-app circle chat, check-ins, SOS broadcast alerts | Member communication and incident response coordination. |
| **Device & Diagnostics** | Battery percentage, OS version, push notification tokens (FCM), crash logs | Low-battery family alerts, push notifications, and performance stability. |

---

## 3. Background Location Disclosure
MyWay requires **Background Location ("Allow all the time")** to deliver core safety features when the app is closed or running in the background:
- **Circle Live Tracking:** Shares your real-time position with authorized members of your private circle.
- **Geofence Automation:** Sends arrival and departure notifications (e.g. Home, Work, School).
- **Crash Detection & SOS:** Immediately transmits distress coordinates to emergency contacts upon high-G impact or SOS activation.

Users can modify location accuracy tiers or enable Ghost Mode at any time in the app settings.

---

## 4. Third-Party Sharing & Sub-processors
We **do not** sell your data. Data is shared only under the following conditions:
1. **Authorized Circle Members:** Real-time location and status are shared strictly with members of circles you have chosen to join.
2. **Infrastructure Sub-processors:**
   - **Google Firebase:** User authentication, encrypted cloud database, push notifications (FCM), and cloud functions.
   - **OpenStreetMap / MapLibre:** Mapping tile rendering and navigation routing.
3. **Legal / Emergency:** When required by law or to protect vital physical safety in life-threatening emergencies.

---

## 5. Security & Retention
- **Encryption:** All data in transit is protected using TLS 1.3 / HTTPS encryption. Data at rest is encrypted within Google Cloud / Firebase.
- **Retention & Deletion:** Users can delete their account and associated location records at any time directly in *Settings > Privacy > Delete Account* or by contacting `support@mywaygps.com`.

---

## 6. Contact Us
For any privacy questions or data deletion requests:
- **Email:** [support@mywaygps.com](mailto:support@mywaygps.com)
- **Website:** [https://myway-gps.web.app](https://myway-gps.web.app)
