import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mywaygps.app',
  appName: 'MyWay',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    Geolocation: {
      permissions: ['location', 'always'] // 'always' enables background location on iOS
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_name',
      iconColor: '#6366f1',
      sound: 'myway_arrival_chime.wav'
    },
    PushNotifications: {
      presentationOptions: ['sound', 'banner', 'list']
    }
  },
  // AUDIT FIX: Deep Link URI scheme registration
  android: {
    allowMixedContent: true,
    // Intent filters added via AndroidManifest.xml for myway:// scheme
  },
  ios: {
    // URL scheme registered in Info.plist for myway://
    scheme: 'myway'
  }
};

export default config;
