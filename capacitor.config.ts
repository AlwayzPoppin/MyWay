import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.myway.app',
  appName: 'MyWay',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    Geolocation: {
      permissions: ['location', 'always'] // 'always' enables background location on iOS
    },
    BackgroundGeolocation: {
      iconColor: '#6366f1',
      notificationTitle: 'MyWay is active',
      notificationText: 'Sharing location with your circle',
      // LAUNCH FIX: Enable background persistence for iOS/Android
      startOnBoot: true,
      stopOnTerminate: false,
      locationProvider: 1 // ACTIVITY_PROVIDER for better battery efficiency
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_name',
      iconColor: '#6366f1',
      sound: 'beep.wav'
    }
  }
};

export default config;
