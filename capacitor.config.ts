import type {CapacitorConfig} from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.gevera.localview",
  appName: "Local View",
  webDir: "mobile/www",
  server: {
    androidScheme: "https"
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
