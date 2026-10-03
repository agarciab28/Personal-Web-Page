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
> variables el job falla en el paso «Validar configuración de despliegue».

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

Secretos **existentes, sin cambios**: `SSH_PRIVATE_KEY`, `SSH_USER`,
`DEPLOY_PATH`.

El antiguo secreto `SSH_HOST` (IP pública) ya no se usa y no hay *fallback* a
él: el despliegue solo se conecta por `SSH_TAILSCALE_HOST`. Puedes borrarlo
cuando el nuevo despliegue funcione.

El job declara `permissions: contents: read` e `id-token: write`; este último
es obligatorio para que la acción de Tailscale pida el token OIDC de GitHub.

## 4. Qué hace el workflow

1. **Validar configuración de despliegue**: comprueba que existen las tres
   variables y los tres secretos y lista por nombre los que falten (nunca
   imprime valores).
2. Instala dependencias (`npm i`) y compila (`npm run build`).
3. **Conectar a Tailscale**: une el runner como nodo efímero con
   `tag:personal-web-deploy` y hace `ping` a `SSH_TAILSCALE_HOST`.
4. **Configurar la llave SSH**: escribe la llave desde una variable de entorno
   con `printf` (quitando `\r` si se pegó con CRLF) y obtiene la clave de host
   con `ssh-keyscan -T 10`. Si no obtiene ninguna clave, falla con un error
   que apunta al grant y a este documento.
5. **Publicar en el servidor**: `rsync -avz --delete dist/` a
   `SSH_USER@SSH_TAILSCALE_HOST:DEPLOY_PATH/` con `StrictHostKeyChecking=yes`,
   `BatchMode=yes`, `IdentitiesOnly=yes` y `ConnectTimeout=10`.

## 5. Pruebas

```sh
node --test tests/
```

`tests/deploy-workflow.test.mjs` comprueba la estructura del workflow y ejecuta
de verdad los scripts de validación, llave SSH y publicación con un `HOME`
temporal; solo `ssh-keyscan` y `rsync` se sustituyen por dobles locales. No
prueban la conectividad real de un runner de GitHub con la tailnet.

Para ver que las pruebas fallan con el workflow anterior:

```sh
git show 0619c14:.github/workflows/deploy.yml > /tmp/deploy-old.yml
DEPLOY_WORKFLOW=/tmp/deploy-old.yml node --test tests/deploy-workflow.test.mjs
```
