# Instalación manual para la demo en vivo

Guía para dejar lista la demo en tu equipo. Toma unos 15 minutos. Si prefieres que lo haga un agente de IA
(Claude Code, Kiro, Codex, Copilot…), usa [AGENTE.md](AGENTE.md).

> **El servidor solo lee.** No inserta, modifica ni borra nada en AWS: lee logs de CloudWatch, parámetros de
> SSM y la API key del gateway, y hace llamadas HTTPS al API Gateway del ambiente no productivo como lo haría
> el front. Si tu perfil apunta a una cuenta distinta de la configurada, el servidor se niega a arrancar.

Los valores entre `<…>` están en el `demo.config.json` que recibiste por correo, sección `aws`.

## Qué necesitas

- Acceso por AWS IAM Identity Center (SSO) a la cuenta `<aws.accountId>`. Si al entrar al portal no ves esa
  cuenta, pide acceso antes de seguir.
- Permisos de lectura en esa cuenta: `sts:GetCallerIdentity`, `ssm:GetParameter` (con `kms:Decrypt` del
  parámetro cifrado), `apigateway:GET`, `logs:FilterLogEvents`, `logs:StartQuery`, `logs:GetQueryResults`.
- Un documento de prueba del ambiente (te lo da quien presenta; nunca uses uno real).

## 1. Clonar y copiar los archivos del correo

```bash
git clone <url-de-este-repo>
cd presentation-live-demo
```

- Copia el HTML de la presentación como `deck/index.html`.
- Copia `demo.config.json` en la raíz del repositorio.

## 2. Instalar Node.js 22

| Sistema | Comando |
|---|---|
| Windows | `winget install OpenJS.NodeJS.LTS` |
| macOS | `brew install node@22` |
| Linux | Gestor de la distribución o [nodejs.org](https://nodejs.org/) |

Comprueba: `node --version` debe mostrar `v22` o superior.

## 3. Instalar AWS CLI v2

| Sistema | Comando |
|---|---|
| Windows | `winget install Amazon.AWSCLI` (o el instalador `https://awscli.amazonaws.com/AWSCLIV2.msi`) |
| macOS | `curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o AWSCLIV2.pkg && sudo installer -pkg AWSCLIV2.pkg -target /` |
| Linux x86_64 | `curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip && unzip awscliv2.zip && sudo ./aws/install` |

Cierra y abre la terminal. Comprueba: `aws --version` debe mostrar `aws-cli/2.x`.

## 4. Configurar el perfil SSO

```bash
aws configure sso
```

| Pregunta | Respuesta |
|---|---|
| SSO session name | El que quieras, por ejemplo `demo` |
| SSO start URL | `<aws.ssoStartUrl>` |
| SSO region | `<aws.ssoRegion>` |
| SSO registration scopes | Enter (`sso:account:access`) |

Se abre el navegador: inicia sesión y autoriza. De vuelta en la terminal:

| Pregunta | Respuesta |
|---|---|
| Cuenta | `<aws.accountId>` |
| Rol | El que te asignaron (sugerido: `<aws.roleName>`) |
| Default client Region | `<aws.region>` |
| CLI default output format | Enter |
| Profile name | El que quieras (sugerido: `<aws.defaultProfile>`). **Recuérdalo**: el servidor te lo pedirá. |

También puedes agregarlo a mano en `~/.aws/config` (`%USERPROFILE%\.aws\config` en Windows):

```ini
[sso-session demo]
sso_start_url = <aws.ssoStartUrl>
sso_region = <aws.ssoRegion>
sso_registration_scopes = sso:account:access

[profile <nombre-del-perfil>]
sso_session = demo
sso_account_id = <aws.accountId>
sso_role_name = <aws.roleName>
region = <aws.region>
```

## 5. Iniciar sesión y comprobar

```bash
aws sso login --profile <nombre-del-perfil>
aws sts get-caller-identity --profile <nombre-del-perfil>
```

El segundo comando debe mostrar `"Account": "<aws.accountId>"`. Cuando la sesión venza, repite `aws sso login`.

## 6. Arrancar

```bash
npm install
npm start
```

1. Escribe el nombre de tu perfil (Enter acepta el sugerido si existe).
2. El servidor verifica que la cuenta sea la configurada.
3. Escribe el documento de prueba (no se ve en pantalla ni se guarda).
4. Abre http://localhost:8787. La píldora de la barra inferior pasa a **En vivo**.

## Problemas frecuentes

| Mensaje | Qué hacer |
|---|---|
| `No existe demo.config.json` / `No existe deck/index.html` | Copia los archivos del correo (paso 1). |
| `falta un valor real en …` | El `demo.config.json` está incompleto o es el de ejemplo: usa el del correo. |
| `El perfil X no existe en ~/.aws/config` | Escribe el nombre exacto del paso 4. |
| `no apunta a la cuenta de …` | El perfil es de otra cuenta. Usa uno con la cuenta del `demo.config.json`. |
| `Renueva la sesión: aws sso login --profile …` | La sesión SSO venció. Ejecuta ese comando y vuelve a `npm start`. |
| `AccessDenied` al leer SSM, la API key o logs | Tu rol no tiene los permisos de lectura de "Qué necesitas". |
| `No hay terminal interactiva` | Ejecuta `npm start` en una terminal normal o define `AWS_PROFILE` y `DEMO_DPI`. |
| `EADDRINUSE` | El puerto 8787 está ocupado: `PORT=8788 npm start`. |
