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
      permissions: ['location']
    },
    BackgroundGeolocation: {
      iconColor: '#6366f1',
      notificationTitle: 'MyWay is active',
      notificationText: 'Sharing location with your circle'
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_name',
      iconColor: '#6366f1',
      sound: 'beep.wav'
    }
  }
};

export default config;
