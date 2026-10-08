# Despliegue al VPS por Tailscale

El workflow `.github/workflows/deploy.yml` compila el sitio y lo publica con
`rsync --delete` en el VPS. El SSH del VPS **no es público**: UFW lo bloquea en
la interfaz pública y solo lo permite por `tailscale0`. Por eso el runner de
GitHub se une primero a la tailnet como nodo efímero con la acción oficial
`tailscale/github-action` (v4.2.0, fijada por SHA
`d1b6cd204f8dceda5b3eaad7f1f767be390056cd`) y después usa OpenSSH normal contra
la IP de Tailscale del VPS.

No hace falta Tailscale SSH: la autenticación sigue siendo la llave de
despliegue (`SSH_PRIVATE_KEY`) con `StrictHostKeyChecking=yes`. No se abre
ningún puerto público ni se cambia el firewall.

> **No hagas merge a `master` ni lances el workflow a mano hasta completar
> toda la configuración de abajo.** Cada push a `master` despliega; sin estas
> variables el job falla en el paso «Validar configuración de despliegue» o
> «Validar configuración de Cloudflare».

## 1. Identidad federada en Tailscale (OIDC, sin secretos de larga duración)

Primero registra `tag:personal-web-deploy` en `tagOwners` y revisa los grants
como se indica en la sección 2; el tag debe existir para poder seleccionarlo.

En la consola de Tailscale → **Settings → Trust credentials**, crea una
credencial de tipo **OpenID Connect / federated identity**:

| Campo | Valor |
| --- | --- |
| Issuer | GitHub (`https://token.actions.githubusercontent.com`) |
| Subject | `repo:agarciab28/Personal-Web-Page:ref:refs/heads/master` |
| Scopes | **Auth Keys → Write** (`auth_keys`), nada más |
| Tags | solo `tag:personal-web-deploy` |

Anota el **Client ID** y el **Audience** que muestra Tailscale. El Audience
debe coincidir exactamente con la variable `TS_AUDIENCE` de abajo.

El Subject limita la credencial a ejecuciones sobre `master` de este
repositorio; ramas, PRs y forks no pueden obtener nodos en la tailnet.

## 2. Tag y grant de mínimo privilegio en la política de la tailnet

Edita la política (**Access controls**) **añadiendo** estas entradas; no
sustituyas la política existente:

```jsonc
"tagOwners": {
  // Ajusta el propietario a tu caso (tu usuario o un grupo de admins).
  "tag:personal-web-deploy": ["autogroup:admin"],
},
"grants": [
  // El runner de despliegue solo puede abrir SSH (tcp:22) contra el VPS.
  {
    "src": ["tag:personal-web-deploy"],
    "dst": ["100.124.13.38"],
    "ip":  ["tcp:22"],
  },
],
```

`100.124.13.38` es la IP de Tailscale actual del VPS. Si prefieres no depender
de la IP, puedes usar un host/tag del VPS en `dst`, siempre limitado a ese
servidor y a `tcp:22`.

Antes de guardar, **revisa los grants o ACLs amplios ya existentes** (por
ejemplo `"src": ["*"]`, `autogroup:member` → `*:*`, o reglas que incluyan
todos los tags): si alguno cubre a `tag:personal-web-deploy`, el runner tendría
más acceso que el previsto. Ajústalos conscientemente en vez de reemplazar la
política a ciegas. Usa la pestaña de *preview* / tests de la política para
comprobar que `tag:personal-web-deploy` solo llega a `100.124.13.38:22`.

## 3. Configuración del repositorio en GitHub

**Settings → Secrets and variables → Actions.**

Variables **nuevas** (pestaña *Variables*, no son secretos):

| Variable | Valor |
| --- | --- |
| `TS_CLIENT_ID` | Client ID de la identidad federada |
| `TS_AUDIENCE` | Audience de la identidad federada (idéntico al de Tailscale) |
| `SSH_TAILSCALE_HOST` | `100.124.13.38` (IP de Tailscale del VPS) |
| `CLOUDFLARE_ZONE_ID` | Zone ID de `alexgar.tech` (32 caracteres hexadecimales en minúscula; ver sección 4) |

Secreto **nuevo** (pestaña *Secrets*):

| Secreto | Valor |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Token de API de Cloudflare con solo *Zone → Cache Purge* (ver sección 4) |

Secretos **existentes, sin cambios**: `SSH_PRIVATE_KEY`, `SSH_USER`,
`DEPLOY_PATH`.

El antiguo secreto `SSH_HOST` (IP pública) ya no se usa y no hay *fallback* a
él: el despliegue solo se conecta por `SSH_TAILSCALE_HOST`. Puedes borrarlo
cuando el nuevo despliegue funcione.

El job declara `permissions: contents: read` e `id-token: write`; este último
es obligatorio para que la acción de Tailscale pida el token OIDC de GitHub.

## 4. Purga de caché de Cloudflare

Tras publicar, el workflow pide a Cloudflare que purgue la caché **solo** de
`alexgar.tech` y `www.alexgar.tech` (purga por host,
`POST /client/v4/zones/{zone_id}/purge_cache` con
`{"hosts": ["alexgar.tech", "www.alexgar.tech"]}`). Nunca purga toda la zona
(`purge_everything`) ni otros subdominios.

**Token de API** — en Cloudflare → **My Profile → API Tokens → Create Token →
Custom token**:

| Campo | Valor |
| --- | --- |
| Permissions | **Zone → Cache Purge → Purge**, nada más |
| Zone Resources | **Include → Specific zone → `alexgar.tech`** (no «All zones») |
| Client IP filtering / TTL | Opcionales; si pones TTL, recuerda rotarlo antes de que caduque |

Guárdalo como secreto `CLOUDFLARE_API_TOKEN`. El **Zone ID** está en el panel
de `alexgar.tech` → *Overview* → *API* → *Zone ID*; guárdalo como variable
`CLOUDFLARE_ZONE_ID` (no es secreto, pero debe ser exactamente los 32
caracteres hexadecimales en minúscula, sin espacios ni saltos de línea).

**Semántica de fallo**:

- Si falta la variable o el secreto, o el Zone ID no tiene el formato correcto,
  el job falla en «Validar configuración de Cloudflare», **antes** de compilar
  y de publicar nada.
- Si la purga falla tras `rsync`, **el sitio nuevo ya está publicado en el
  VPS** pero el workflow queda en rojo: puede que Cloudflare siga sirviendo
  contenido antiguo hasta que caduque. Vuelve a lanzar el workflow (o purga a
  mano esos dos hosts) cuando se resuelva la causa.
- Reintenta solo errores transitorios (red, tiempo agotado, HTTP 429 y 5xx),
  con un máximo de 4 intentos, 15 s por petición y espera exponencial (2 s,
  4 s, 8 s; respeta `Retry-After` con tope de 30 s). El paso tiene además
  `timeout-minutes: 3`. Los 4xx (por ejemplo 403 por permisos del token), las
  respuestas con JSON inválido y las que no traen `"success": true` fallan sin
  reintentar.
- El log nunca muestra el token ni el cuerpo de la respuesta; solo el estado
  HTTP y, si los hay, los códigos numéricos de error de Cloudflare.

Un éxito significa que Cloudflare **aceptó** la petición de purga, no que se
haya comprobado que todos sus nodos ya la aplicaron. Tampoco afecta a la caché
de los navegadores de los visitantes, que depende de las cabeceras
`Cache-Control` que sirve el VPS.

## 5. Qué hace el workflow

1. **Validar configuración de despliegue**: comprueba que existen las tres
   variables y los tres secretos y lista por nombre los que falten (nunca
   imprime valores).
2. **Validar configuración de Cloudflare**: comprueba que existen
   `CLOUDFLARE_ZONE_ID` (con formato de 32 hexadecimales en minúscula) y
   `CLOUDFLARE_API_TOKEN`, sin imprimir valores.
3. Instala dependencias (`npm i`) y compila (`npm run build`).
4. **Conectar a Tailscale**: une el runner como nodo efímero con
   `tag:personal-web-deploy` y hace `ping` a `SSH_TAILSCALE_HOST`.
5. **Configurar la llave SSH**: escribe la llave desde una variable de entorno
   con `printf` (quitando `\r` si se pegó con CRLF) y obtiene la clave de host
   con `ssh-keyscan -T 10`. Si no obtiene ninguna clave, falla con un error
   que apunta al grant y a este documento.
6. **Publicar en el servidor**: `rsync -avz --delete dist/` a
   `SSH_USER@SSH_TAILSCALE_HOST:DEPLOY_PATH/` con `StrictHostKeyChecking=yes`,
   `BatchMode=yes`, `IdentitiesOnly=yes` y `ConnectTimeout=10`.
7. **Purgar caché de Cloudflare**: `node scripts/cloudflare-purge.mjs` (ver
   sección 4). Solo se ejecuta si todo lo anterior ha ido bien.

## 6. Pruebas

```sh
npm test   # node --test tests/*.test.mjs
```

La suite completa se verificó con Node 26 (102 pruebas). Con Node 20, usado
por el workflow, las pruebas de despliegue y purga pasan; siete pruebas
preexistentes de `contact.test.mjs` requieren capacidades de carga de TypeScript
que no están disponibles en ese runtime. El workflow no ejecuta esa suite y
este cambio no modifica el código de contacto ni la versión de Node.

Referencia oficial de la purga por host:
https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-hostname/

`tests/deploy-workflow.test.mjs` comprueba la estructura del workflow y ejecuta
de verdad los scripts de validación, llave SSH y publicación con un `HOME`
temporal; solo `ssh-keyscan` y `rsync` se sustituyen por dobles locales. No
prueban la conectividad real de un runner de GitHub con la tailnet.

`tests/cloudflare-purge.test.mjs` prueba `scripts/cloudflare-purge.mjs` con un
`fetch` y un `sleep` simulados (URL, cabeceras, hosts, reintentos, timeouts,
redacción del token) y ejecuta el CLI con `fetch` sustituido mediante
`--import`. Ninguna prueba llama a la API real de Cloudflare.

Para ver que las pruebas fallan con el workflow anterior:

```sh
git show 0619c14:.github/workflows/deploy.yml > /tmp/deploy-old.yml
DEPLOY_WORKFLOW=/tmp/deploy-old.yml node --test tests/deploy-workflow.test.mjs
```
