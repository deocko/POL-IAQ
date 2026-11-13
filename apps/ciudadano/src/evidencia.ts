import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { api } from './api';

const aHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Toma una foto, calcula su SHA-256 en el teléfono (cadena de custodia),
 * la registra en el API y sube el archivo. El servidor vuelve a calcular el
 * hash y rechaza el archivo si no coincide.
 */
export async function tomarYSubirFoto(token: string, folio: string): Promise<'ok' | 'cancelado' | 'sin_permiso'> {
  const permiso = await ImagePicker.requestCameraPermissionsAsync();
  if (!permiso.granted) return 'sin_permiso';
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, exif: false });
  if (r.canceled || !r.assets[0]) return 'cancelado';

  const asset = r.assets[0];
  const archivo = new File(asset.uri);
  const bytes = await archivo.arrayBuffer();
  const sha256 = aHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  const mimeType = asset.mimeType ?? 'image/jpeg';

  const destino = await api.solicitarEvidencia(token, folio, { tipo: 'foto', mimeType, bytes: bytes.byteLength, sha256, capturadoEn: new Date().toISOString() });
  const resp = await fetch(destino.subirA, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': mimeType }, body: archivo });
  if (!resp.ok) throw new Error(`No se pudo subir la foto (${resp.status})`);
  return 'ok';
}
