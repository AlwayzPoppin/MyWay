# MyWay GPS - Local Functions Emulator Guide

Since your cloud deployment is currently blocked by IAM permissions, you can use the **Firebase Functions Emulator** to test the CORS and AI fixes on your local machine (`localhost:3000`).

## 🚀 How to Start the Emulator

1. **Open a new terminal window**.
2. **Navigate to the functions directory**:
   ```bash
   cd functions
   ```
3. **Start the emulator**:
   ```bash
   firebase emulators:start --only functions
   ```

## ⚙️ Configuration

Your app is already configured to point to the local emulator if `VITE_USE_FUNCTIONS_EMULATOR=true` is set in your `.env` file.

### Verify .env
Ensure your root `.env` file contains:
```env
VITE_USE_FUNCTIONS_EMULATOR=true
```

## 💡 Benefits
- **No CORS Issues**: The emulator handles origin matching seamlessly for localhost.
- **Instant Feeback**: Changes to your functions are automatically reloaded.
- **No Cloud Permissions Needed**: Tests your logic without interacting with the live Google Cloud project.

---
**Once the emulator is running, refresh http://localhost:3000/ to start using the fixed AI and Search features!**
