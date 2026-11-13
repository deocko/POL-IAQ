/**
 * Configuración dinámica de Expo sobre app.json.
 * GOOGLE_MAPS_ANDROID_API_KEY: llave de Google Maps SDK for Android. Expo Go no
 * la necesita; un build de Android (EAS) sí. En iOS se usa Apple Maps, sin llave.
 */
module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    ['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }],
  ],
});
