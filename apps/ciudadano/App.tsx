import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Registro } from './src/pantallas/Registro';
import { Inicio } from './src/pantallas/Inicio';
import { Seguimiento } from './src/pantallas/Seguimiento';

/**
 * App Ciudadano de Pol-IAQ (scaffold).
 * TODO(fase 1): guardar el token en expo-secure-store y migrar a Expo Router.
 */
export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [folio, setFolio] = useState<string | null>(null);

  return (
    <>
      <StatusBar style="dark" />
      {!token ? (
        <Registro alEntrar={(t) => setToken(t)} />
      ) : folio ? (
        <Seguimiento token={token} folio={folio} alSalir={() => setFolio(null)} />
      ) : (
        <Inicio token={token} alCrear={setFolio} />
      )}
    </>
  );
}
