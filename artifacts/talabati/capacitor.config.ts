import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.mizu.app",
  appName: "Mizu",
  webDir: "dist/public",
  android: {
    buildOptions: {
      releaseType: "APK",
    },
  },
  server: {
    androidScheme: "https",
    cleartext: false,
    url: "https://mizu-nyv1.onrender.com",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
