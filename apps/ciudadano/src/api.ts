import { io, type Socket } from 'socket.io-client';
import type { EstadoIncidente } from '@pol-iaq/shared/movil';

/** URL del API. En desarrollo usa la IP de tu computadora, no "localhost", si pruebas en un teléfono. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
/** Sitio web donde se publican el Aviso de Privacidad y los Términos. */
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:3001';

export interface IncidenteCatalogoPublico {
  id: string;
  categoria: string;
  nombreCiudadano: string;
  prioridad: 'alta' | 'media' | 'baja';
}

export interface ReporteVista {
  folio: string;
  estado: EstadoIncidente;
  estadoTexto: string;
  ubicacion: { lat: number; lng: number };
  unidad: { etiqueta: string; corporacion: string; etaMinutos?: number; lat?: number; lng?: number; rumbo?: number; actualizadoEn?: string } | null;
  mensajes: { id: string; autor: string; nombreAutor?: string; texto: string; en: string }[];
  historial: { estado: EstadoIncidente; en: string; nota?: string }[];
  evidencias: { id: string; tipo: string; estado: string }[];
}

export class ErrorApi extends Error {
  constructor(readonly status: number, readonly codigo: string, mensaje?: string) {
    super(mensaje ?? codigo);
  }
}

async function llamar<T>(ruta: string, opciones: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...resto } = opciones;
  const resp = await fetch(`${API_URL}${ruta}`, {
    ...resto,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers as Record<string, string>) },
  });
  const cuerpo = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ErrorApi(resp.status, cuerpo.codigo ?? 'error', cuerpo.mensaje);
  return cuerpo as T;
}

export const api = {
  solicitarOtp: (telefono: string) => llamar('/v1/auth/otp', { method: 'POST', body: JSON.stringify({ telefono }) }),
  verificar: (datos: { telefono: string; codigo: string; nombre: string; aceptaAvisoPrivacidad: string; aceptaTerminos: string }) =>
    llamar<{ token: string; ciudadano: { id: string; nombre: string } }>('/v1/auth/verificar', { method: 'POST', body: JSON.stringify(datos) }),
  catalogo: () => llamar<{ incidentes: IncidenteCatalogoPublico[] }>('/v1/catalogo'),
  crearReporte: (token: string, datos: { incidenteId: string; ubicacion: { lat: number; lng: number; precisionMetros?: number }; esPanico?: boolean; descripcion?: string }) =>
    llamar<ReporteVista>('/v1/reportes', { method: 'POST', token, body: JSON.stringify(datos) }),
  reporte: (token: string, folio: string) => llamar<ReporteVista>(`/v1/reportes/${folio}`, { token }),
  mensaje: (token: string, folio: string, texto: string) => llamar<ReporteVista>(`/v1/reportes/${folio}/mensajes`, { method: 'POST', token, body: JSON.stringify({ texto }) }),
  cancelar: (token: string, folio: string) => llamar<ReporteVista>(`/v1/reportes/${folio}/cancelar`, { method: 'POST', token }),
  solicitarEvidencia: (token: string, folio: string, datos: { tipo: 'foto' | 'video' | 'audio'; mimeType: string; bytes: number; sha256: string; capturadoEn: string }) =>
    llamar<{ evidenciaId: string; subirA: string; metodo: 'PUT' }>(`/v1/reportes/${folio}/evidencias`, { method: 'POST', token, body: JSON.stringify(datos) }),
};

/** Abre el canal de seguimiento en tiempo real de un folio. */
export function seguir(token: string, folio: string, alActualizar: (r: ReporteVista) => void): Socket {
  const socket = io(`${API_URL}/seguimiento`, { transports: ['websocket'] });
  socket.on('connect', () => {
    socket.emit('suscribir', { token, folio }, (resp: { ok: boolean; reporte?: ReporteVista }) => {
      if (resp.ok && resp.reporte) alActualizar(resp.reporte);
    });
  });
  socket.on('reporte.actualizado', alActualizar);
  return socket;
}
