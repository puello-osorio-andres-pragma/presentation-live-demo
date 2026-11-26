# presentation-live-demo

Servidor local de **solo lectura** que da vida a una presentación HTML: ejecuta una transacción de punta a
punta contra el API Gateway de un ambiente AWS **no productivo** y muestra los logs de CloudWatch en tiempo
real, todo enmascarado.

## Qué necesitas

| Pieza | De dónde sale |
|---|---|
| Este repositorio | `git clone` |
| `deck/index.html` | El HTML de la presentación que recibiste por correo |
| `demo.config.json` | El archivo de configuración que recibiste por correo (va en la raíz del repo) |
| Node.js 22, AWS CLI v2 y un perfil SSO del ambiente | [INSTALACION.md](INSTALACION.md) o, con un agente de IA, [AGENTE.md](AGENTE.md) |

La presentación y la configuración no viven en el repositorio: `.gitignore` las excluye para que ningún dato
del ambiente quede publicado. `demo.config.example.json` muestra la estructura con placeholders.

## Qué hace y qué no hace el servidor

**Solo lee. No inserta, modifica ni borra nada en ninguna herramienta de AWS.**

| Hace | Contra qué |
|---|---|
| Verifica que el perfil apunte a la cuenta configurada y aborta si no | `sts:GetCallerIdentity` |
| Lee el secreto de firma del comercio de pruebas y la llave pública JWE | `ssm:GetParameter` |
| Lee el valor de la API key del gateway | `apigateway:GET` |
| Lee logs y ejecuta consultas de Logs Insights | `logs:FilterLogEvents`, `logs:StartQuery`, `logs:GetQueryResults` |
| Llama al API Gateway del ambiente, igual que el front real | `fetch` HTTPS |

- Si el perfil elegido apunta a otra cuenta (por ejemplo, producción), el servidor **no arranca**. Así, quien
  tenga permisos en un ambiente productivo no puede apuntar la demo allí por error.
- `test/read-only.test.mjs` falla si alguien importa un comando del SDK que no sea de lectura.
- Lo único que se crea es lo que crea el propio producto al recibir las llamadas al gateway: una transacción
  de prueba en el ambiente no productivo, como cualquier operación del front.
- El navegador nunca habla con AWS: todo pasa por el servidor local (`127.0.0.1`), que enmascara documentos,
  cuentas, tokens, nombres y correos antes de responder. Los secretos viven solo en memoria.

## Arranque

```bash
git clone <url-de-este-repo>
cd presentation-live-demo
# copia deck/index.html y demo.config.json desde el correo
aws sso login --profile <tu-perfil>
npm install
npm start
```

El servidor pregunta el nombre de tu perfil AWS (muestra los de `~/.aws/config`) y el documento de prueba
con entrada oculta, que no se guarda. Luego abre http://localhost:8787.

| Variable | Uso | Por defecto |
|---|---|---|
| `AWS_PROFILE` | Perfil SSO sin preguntarlo | se pregunta |
| `DEMO_DPI` | Documento de prueba sin pedirlo por consola | se pregunta |
| `DEMO_CONFIG` | Ruta alternativa del archivo de configuración | `./demo.config.json` |
| `PORT` | Puerto local | `8787` |

## Biometría en la demo

Al pulsar **Iniciar biometría** aparece un QR. Escanéalo con el celular y completa la prueba de vida. El
proveedor redirige al front real, que mostrará un error porque no tiene el `resumeToken`: es lo esperado.
Vuelve a la presentación y pulsa **Ya me autentiqué**.

## Para quien presenta

```bash
npm run package -- <nombre-del-html>
```

Deja en `dist/` el HTML de la presentación y `demo.config.json`, listos para adjuntar en el correo.

## Pruebas

```bash
npm test
```

`node:test` con cobertura mínima del 90% en líneas, ramas y funciones sobre `src/`.
