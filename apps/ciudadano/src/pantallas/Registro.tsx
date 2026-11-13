import { useState } from 'react';
import { Linking, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { AVISO_PRIVACIDAD_VERSION, TERMINOS_VERSION } from '@pol-iaq/shared/movil';
import { api, ErrorApi, WEB_URL } from '../api';
import { colores, e } from '../estilos';

/**
 * Registro con celular verificado y aceptación expresa del Aviso de
 * Privacidad y los Términos y Condiciones. Ninguna casilla viene marcada.
 */
export function Registro({ alEntrar }: { alEntrar: (token: string, nombre: string) => void }) {
  const [telefono, setTelefono] = useState('+52');
  const [nombre, setNombre] = useState('');
  const [codigo, setCodigo] = useState('');
  const [otpEnviado, setOtpEnviado] = useState(false);
  const [aceptaAviso, setAceptaAviso] = useState(false);
  const [aceptaTerminos, setAceptaTerminos] = useState(false);
  const [aceptaUbicacion, setAceptaUbicacion] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const puedeContinuar = aceptaAviso && aceptaTerminos && aceptaUbicacion && nombre.trim().length >= 2;

  async function enviarOtp() {
    setError(null);
    try {
      await api.solicitarOtp(telefono);
      setOtpEnviado(true);
    } catch (err) {
      setError(err instanceof ErrorApi ? `No pudimos enviar el código (${err.codigo}).` : 'Sin conexión con el servidor.');
    }
  }

  async function verificar() {
    setError(null);
    try {
      const r = await api.verificar({ telefono, codigo, nombre: nombre.trim(), aceptaAvisoPrivacidad: AVISO_PRIVACIDAD_VERSION, aceptaTerminos: TERMINOS_VERSION });
      alEntrar(r.token, r.ciudadano.nombre);
    } catch (err) {
      setError(err instanceof ErrorApi && err.codigo === 'otp_invalido' ? 'El código no es correcto.' : 'No pudimos verificar tu número.');
    }
  }

  return (
    <ScrollView style={e.pantalla} contentContainerStyle={{ paddingBottom: 48 }}>
      <Text style={e.titulo}>Pol-IAQ</Text>
      <Text style={e.texto}>Reporta emergencias a la policía de tu municipio y sigue la atención en tiempo real.</Text>
      <View style={[e.tarjeta, { marginTop: 16 }]}>
        <Text style={e.texto}>Pol-IAQ no sustituye al 911. Si no puedes usar la app, llama al 911.</Text>
      </View>

      <Text style={e.subtitulo}>Tus datos</Text>
      <TextInput style={e.input} placeholder="Nombre completo" value={nombre} onChangeText={setNombre} autoComplete="name" />
      <TextInput style={e.input} placeholder="+52 y 10 dígitos" value={telefono} onChangeText={setTelefono} keyboardType="phone-pad" autoComplete="tel" />

      <Text style={e.subtitulo}>Antes de continuar</Text>
      <Casilla valor={aceptaAviso} cambiar={setAceptaAviso}>
        He leído y acepto el <Enlace ruta="aviso-privacidad">Aviso de Privacidad</Enlace>, incluido el tratamiento de mi ubicación, fotos, videos y audios.
      </Casilla>
      <Casilla valor={aceptaTerminos} cambiar={setAceptaTerminos}>
        Acepto los <Enlace ruta="terminos">Términos y Condiciones de uso</Enlace> y entiendo que reportar falsas emergencias puede ser sancionado.
      </Casilla>
      <Casilla valor={aceptaUbicacion} cambiar={setAceptaUbicacion}>
        Autorizo compartir mi ubicación con la corporación que atienda mi reporte mientras esté activo.
      </Casilla>

      {!otpEnviado ? (
        <Pressable style={[e.boton, !puedeContinuar && { opacity: 0.4 }]} disabled={!puedeContinuar} onPress={enviarOtp}>
          <Text style={e.botonTexto}>Enviar código por SMS</Text>
        </Pressable>
      ) : (
        <>
          <TextInput style={e.input} placeholder="Código de 6 dígitos" value={codigo} onChangeText={setCodigo} keyboardType="number-pad" maxLength={6} />
          <Pressable style={e.boton} onPress={verificar}>
            <Text style={e.botonTexto}>Verificar y entrar</Text>
          </Pressable>
        </>
      )}
      {error && <Text style={e.error}>{error}</Text>}
      <Text style={[e.suave, { marginTop: 16 }]}>Versión del aviso: {AVISO_PRIVACIDAD_VERSION} · Términos: {TERMINOS_VERSION}</Text>
    </ScrollView>
  );
}

function Casilla({ valor, cambiar, children }: { valor: boolean; cambiar: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <View style={[e.fila, { marginBottom: 12 }]}>
      <Switch value={valor} onValueChange={cambiar} />
      <Text style={[e.texto, { flex: 1 }]}>{children}</Text>
    </View>
  );
}

function Enlace({ ruta, children }: { ruta: string; children: React.ReactNode }) {
  return (
    <Text style={{ color: colores.primario, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(`${WEB_URL}/legal/${ruta}`)}>
      {children}
    </Text>
  );
}
