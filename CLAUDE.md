# CLAUDE.md — Herramienta de recorte automático de vídeos largos a shorts verticales

## Objetivo del proyecto

Construir una herramienta **independiente y autosuficiente** (no forma parte de ningún otro proyecto del usuario, como su SaaS de chat) que:

1. Recibe un vídeo largo (subida directa o URL de YouTube)
2. Lo transcribe
3. Detecta con IA los mejores momentos ("virales") de 15-60s
4. Los recorta
5. Reencuadra cada clip a formato vertical 9:16 siguiendo al hablante
6. Quema subtítulos animados
7. Añade zooms/paneos sutiles y textos de gancho generados por IA
8. Entrega los clips finales listos para descargar

**Uso**: privado, un único usuario (el propietario), sin necesidad de gestión de usuarios múltiples ni roles.

**Alcance de esta v1 (MVP)**: SOLO generación de clips. NO incluir:
- Módulo de "AI Shorts" (generación de vídeos UGC con actores IA) — no es necesario, elimínalo o no lo actives
- Módulo "YouTube Studio" (miniaturas/títulos) — no es necesario ahora
- Publicación automática a redes sociales — se añadirá en una fase 2 posterior, no la implementes todavía, pero no cierres la puerta a añadirla (deja la arquitectura preparada para poder enchufar esa pieza más adelante sin reescribir el core)
- Música de fondo y b-roll/stock — fase 2, no la implementes ahora

## Base de partida

Usa como base y referencia el proyecto open source **OpenShorts** (`github.com/mutonby/openshorts`, licencia MIT, Python 3.11 + FastAPI + React 18 + Vite + Tailwind), del cual solo nos interesa el módulo "Clip Generator". Fork limpio: elimina o desactiva por completo los módulos de AI Shorts y YouTube Studio para mantener el proyecto ligero, autocontenido y sin dependencias que no vamos a usar (no se necesitan las API keys de fal.ai ni ElevenLabs).

Pipeline técnico a implementar (igual que OpenShorts Clip Generator):
1. **Ingesta**: subida de archivo local o descarga vía `yt-dlp` desde URL de YouTube
2. **Transcripción**: `faster-whisper` local (sin coste de API), con timestamps por palabra
3. **Detección de escenas**: `PySceneDetect`
4. **Detección de momentos virales**: Google Gemini analiza la transcripción y devuelve 3-15 fragmentos candidatos con timestamps
5. **Corte**: `FFmpeg`
6. **Reencuadre vertical inteligente**: `MediaPipe` + `YOLOv8` (seguimiento de cara/sujeto)
7. **Subtítulos + efectos**: subtítulos quemados estilo karaoke vía `FFmpeg` + `libass`, zooms/paneos y hook text generados por Gemini como filtros FFmpeg

## Requisito de autosuficiencia

La herramienta debe funcionar de forma completamente autocontenida dentro de sus propios contenedores Docker. Las únicas dependencias externas permitidas son APIs estrictamente necesarias:
- **Google Gemini API** (obligatoria — detección de momentos virales)
- Nada más por ahora. No integres fal.ai, ElevenLabs, Upload-Post ni AWS S3 en esta v1 (todo el almacenamiento de clips debe ser en disco local del VPS, con limpieza automática — ver más abajo).

## Servidor de despliegue

- **Proveedor**: Contabo — Cloud VPS 6
- **Specs**: 6 vCPU, 12 GB RAM, 200 GB SSD, sin GPU (todo el procesamiento de IA local corre en CPU)
- **Dominio**: `youtube.omarpumariega.com` (subdominio dedicado a esta herramienta)
- El desarrollo se hace en local (terminal / VS Code), pero el **destino final es este VPS**. La app debe quedar lista para desplegarse ahí vía Docker Compose, no para quedarse corriendo solo en local.

### Ajustes de configuración acordes al servidor
- Modelo de `faster-whisper`: usar `small` o `medium` (con 12 GB de RAM hay margen; no uses `large` para no comprometer el resto del sistema)
- `MAX_CONCURRENT_JOBS`: limitar a 2 (con 6 vCPU y procesamiento de vídeo pesado, más concurrencia satura la máquina)
- Política de limpieza automática de archivos temporales: los vídeos largos sin comprimir pesan mucho frente a los 200 GB disponibles. Configura borrado automático de: vídeo original descargado/subido, archivos intermedios de audio, y jobs completados tras la descarga del usuario (o un máximo de 24-48h de retención). Deja el intervalo como variable de entorno configurable.

## Despliegue: arquitectura Docker en el VPS

- **Docker Compose** para levantar todos los servicios (backend FastAPI, frontend, worker de procesamiento)
- **Reverse proxy con HTTPS automático**: usa **Caddy** (más simple que Nginx + Certbot manual) para servir `youtube.omarpumariega.com` con certificado SSL automático vía Let's Encrypt
- Antes de desplegar, comprobar en el VPS qué puertos/servicios ya están en uso (`sudo ss -tulpn`) para no chocar con otros proyectos que puedan estar corriendo ahí, y asignar puertos internos que no colisionen
- Verificar si Docker y Docker Compose ya están instalados en el VPS; si no, incluir los comandos de instalación como parte del proceso de despliegue

## Seguridad de acceso

Uso privado, un solo usuario, sin necesidad de sistema de login completo con roles. Protege el acceso a la interfaz con **autenticación básica HTTP** (usuario/contraseña) configurada a nivel de Caddy/reverse proxy, para que la herramienta no quede abierta públicamente en internet sin más. La API key de Gemini debe guardarse como variable de entorno en el servidor (`.env`), nunca hardcodeada ni expuesta al frontend.

## Variables de entorno necesarias

```
GEMINI_API_KEY=           # obligatoria
MAX_CONCURRENT_JOBS=2
WHISPER_MODEL=small        # o "medium" si el rendimiento lo permite
CLEANUP_RETENTION_HOURS=48
BASIC_AUTH_USER=
BASIC_AUTH_PASSWORD=
DOMAIN=youtube.omarpumariega.com
```

## Entregables esperados de esta sesión de trabajo

1. Repositorio del proyecto (fork limpio de OpenShorts reducido al módulo Clip Generator) funcionando en local
2. `docker-compose.yml` + `Dockerfile`(s) listos para producción
3. `Caddyfile` configurado para `youtube.omarpumariega.com` con HTTPS automático y basic auth
4. `.env.example` documentado
5. Script o guía paso a paso de despliegue en el VPS de Contabo (desde clonar el repo en el servidor hasta tenerlo accesible en el dominio final)
6. README breve explicando cómo levantar el proyecto en local para seguir desarrollándolo

## Fuera de alcance ahora (Fase 2 — no implementar todavía, pero no bloquear arquitecturalmente)

- Publicación automática programada a TikTok/Reels/YouTube Shorts con miniaturas y textos
- Música de fondo con audio ducking
- Inserción de b-roll/stock de vídeo
- Multi-usuario / gestión de clientes
