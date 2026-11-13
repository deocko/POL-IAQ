import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { PERFIL_VACIO, PROTOCOLO_PROVISIONAL, type Perfil, type Protocolo } from '@pol-iaq/shared/movil';
import { api } from './src/api';
import { Registro } from './src/pantallas/Registro';
import { Inicio } from './src/pantallas/Inicio';
import { Seguimiento } from './src/pantallas/Seguimiento';
import { Lugares } from './src/pantallas/Lugares';
import { Asistente911, type ContinuarReporte } from './src/pantallas/Asistente911';

type Pantalla =
  | { tipo: 'inicio' }
  | { tipo: 'seguimiento'; folio: string }
  | { tipo: 'asistente'; continuar?: ContinuarReporte }
  | { tipo: 'lugares' };

/**
 * App Ciudadano de Pol-IAQ (scaffold).
 * TODO(fase 1): guardar el token en expo-secure-store y migrar a Expo Router.
 */
export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [pantalla, setPantalla] = useState<Pantalla>({ tipo: 'inicio' });
  const [perfil, setPerfil] = useState<Perfil>(PERFIL_VACIO);
  // Protocolo vigente del servidor; sin conexión se usa el que trae la app.
  const [protocolo, setProtocolo] = useState<Protocolo>(PROTOCOLO_PROVISIONAL);

  useEffect(() => {
    if (!token) return;
    api.perfil(token).then(setPerfil).catch(() => undefined);
    api.protocolo().then(setProtocolo).catch(() => undefined);
  }, [token]);

  const inicio = () => setPantalla({ tipo: 'inicio' });
  const seguir = (folio: string) => setPantalla({ tipo: 'seguimiento', folio });

  return (
    <>
      <StatusBar style="dark" />
      {!token ? (
        <Registro alEntrar={(t) => setToken(t)} />
      ) : pantalla.tipo === 'seguimiento' ? (
        <Seguimiento token={token} folio={pantalla.folio} alSalir={inicio} alContinuar={(continuar) => setPantalla({ tipo: 'asistente', continuar })} />
      ) : pantalla.tipo === 'asistente' ? (
        <Asistente911 token={token} protocolo={protocolo} continuar={pantalla.continuar} alTerminar={seguir} alSalir={inicio} />
      ) : pantalla.tipo === 'lugares' ? (
        <Lugares token={token} perfil={perfil} alCambiar={setPerfil} alSalir={inicio} />
      ) : (
        <Inicio token={token} perfil={perfil} alCrear={seguir} alAsistente={(continuar) => setPantalla({ tipo: 'asistente', continuar })} alLugares={() => setPantalla({ tipo: 'lugares' })} />
      )}
    </>
  );
}
