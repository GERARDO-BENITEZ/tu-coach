# Cómo iniciar el servidor de Tu Coach

## Pasos

**1. Abre la terminal en la carpeta del proyecto**
```bash
cd "/Users/gerardobenitezrodriguez/Desktop/app tu coach"
```

**2. Instala las dependencias** (solo la primera vez o si cambió `package.json`)
```bash
npm install
```

**3. Verifica que el `.env` tenga tus claves**
Debe contener valores reales (no vacíos) para:
- `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI`
- `GARMIN_EMAIL`, `GARMIN_PASSWORD`
- `ANTHROPIC_API_KEY`

**4. Arranca el servidor**

Modo normal:
```bash
npm start
```

Modo desarrollo (se reinicia solo al guardar cambios):
```bash
npm run dev
```

**5. Abre la app en el navegador**
Al iniciar, la terminal mostrará la dirección del servidor. Ábrela en el navegador.

---

**Para detenerlo:** `Ctrl + C` en la terminal.
