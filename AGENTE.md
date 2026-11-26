# Instalación asistida por un agente de IA

Pásale este archivo a tu agente (Claude Code, Kiro, Codex, GitHub Copilot, Gemini u otro) desde la carpeta
del repositorio, con una instrucción como:

> Lee AGENTE.md y deja lista la demo en vivo en mi equipo.

Todo lo que sigue va dirigido al agente.

---

## Instrucciones para el agente

Tu tarea: instalar Node.js 22 y AWS CLI v2 si faltan, configurar un perfil AWS SSO hacia la cuenta indicada en
`demo.config.json` y dejar la demo arrancable. La guía equivalente para humanos es `INSTALACION.md`.

### Reglas que no se negocian

1. **Solo lectura en AWS.** No ejecutes ningún comando que cree, modifique o borre recursos (`put-*`,
   `create-*`, `update-*`, `delete-*`, `send-*`, `invoke`…). Los únicos comandos AWS que necesitas son
   `aws --version`, `aws configure sso` o la edición de `~/.aws/config`, `aws sso login` y
   `aws sts get-caller-identity`.
2. **Solo la cuenta `aws.accountId` de `demo.config.json`.** Si el usuario tiene perfiles de otras cuentas
   (incluida producción), no los toques ni los uses. El servidor también lo verifica y se niega a arrancar.
3. **No modifiques perfiles existentes** en `~/.aws/config`. Si ya hay uno con esa cuenta, úsalo. Si vas a
   agregar uno, primero copia el archivo a `~/.aws/config.bak` y agrega al final.
4. **No pidas ni guardes el documento de prueba.** Lo escribe el usuario en la terminal al arrancar.
5. **No guardes tokens ni credenciales** en archivos del proyecto ni los muestres en la respuesta.
6. **No subas `demo.config.json` ni `deck/`** a ningún repositorio: ya están en `.gitignore`.
7. Antes de instalar software, dile al usuario qué vas a instalar y espera su visto bueno.

### Paso 1. Diagnóstico

Comprueba que existan `demo.config.json` en la raíz y `deck/index.html`. Si falta alguno, pídele al usuario
que copie los archivos que recibió por correo y detente hasta que estén.

Lee de `demo.config.json` la sección `aws`: `accountId`, `region`, `ssoStartUrl`, `ssoRegion`, `roleName`,
`defaultProfile`.

Ejecuta y reporta en una sola tabla:

```bash
node --version
aws --version
```

y busca en `~/.aws/config` (`%USERPROFILE%\.aws\config` en Windows) perfiles con
`sso_account_id = <aws.accountId>`.

### Paso 2. Instalar lo que falte (con confirmación)

| Falta | Windows | macOS | Linux x86_64 |
|---|---|---|---|
| Node ≥ 22 | `winget install OpenJS.NodeJS.LTS` | `brew install node@22` | gestor de la distribución |
| AWS CLI v2 | `winget install Amazon.AWSCLI` | `curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o AWSCLIV2.pkg && sudo installer -pkg AWSCLIV2.pkg -target /` | `curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip && unzip awscliv2.zip && sudo ./aws/install` |

En Windows, después de `winget` la terminal actual no ve el nuevo `PATH`: pide al usuario abrir una terminal
nueva o usa la ruta completa (`C:\Program Files\Amazon\AWSCLIV2\aws.exe`).

### Paso 3. Perfil SSO

Si ya existe un perfil hacia `aws.accountId`, salta al paso 4 con ese nombre.

Si no, pregunta al usuario en una sola tanda:

- Nombre que quiere para el perfil (sugiere `aws.defaultProfile`).
- Nombre del rol que ve en el portal de AWS para esa cuenta (sugiere `aws.roleName`).

Agrega al final de `~/.aws/config`, con los valores de `demo.config.json` (si ya existe una `sso-session` con
el mismo `sso_start_url`, reutilízala en lugar de duplicarla):

```ini
[sso-session demo]
sso_start_url = <aws.ssoStartUrl>
sso_region = <aws.ssoRegion>
sso_registration_scopes = sso:account:access

[profile <NOMBRE_DEL_PERFIL>]
sso_session = demo
sso_account_id = <aws.accountId>
sso_role_name = <ROL>
region = <aws.region>
```

### Paso 4. Login (lo hace el usuario)

`aws sso login` abre el navegador y requiere que el usuario autorice. Pídele que lo ejecute él. En Claude Code
puede escribir en el prompt:

```
! aws sso login --profile <NOMBRE_DEL_PERFIL>
```

Luego verifica tú:

```bash
aws sts get-caller-identity --profile <NOMBRE_DEL_PERFIL>
```

Debe devolver `"Account": "<aws.accountId>"`. Si devuelve otra cuenta, detente y avisa: el perfil está mal.

### Paso 5. Dependencias

```bash
npm install
```

### Paso 6. Entrega al usuario

No arranques el servidor tú: pide un documento de prueba que el usuario escribe con entrada oculta. Termina
con este mensaje:

> Listo. Para la demo ejecuta `npm start` en esta carpeta, escribe **<NOMBRE_DEL_PERFIL>** cuando pregunte el
> perfil y el documento de prueba cuando lo pida. Abre http://localhost:8787. Si la sesión vence:
> `aws sso login --profile <NOMBRE_DEL_PERFIL>`.

### Si algo falla

| Síntoma | Acción |
|---|---|
| `aws sso login` no muestra la cuenta | El usuario no tiene acceso: debe pedirlo. No intentes otras cuentas. |
| `AccessDenied` en SSM, API Gateway o logs al arrancar | El rol no tiene permisos de lectura (lista en `INSTALACION.md`). Repórtalo, no cambies de cuenta. |
| `winget`/`brew` no disponible | Da al usuario el instalador oficial de la tabla del paso 2. |
