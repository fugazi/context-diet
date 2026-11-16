# Roadmap

Estado al 2026-11-14 · versión 1.1.0 · probado con Claude Code 2.1.325.

## Hecho

### Base de pruebas
- [x] Harness propio (`test/harness.mjs`, con un `$` falso) reemplazado por `claude plugin test`: los tests corren contra el motor real, con el mod cargado desde la carpeta.
- [x] Módulo en TypeScript, con contrato de tipos (`types/index.d.ts`) que `claude plugin validate` verifica contra cada clave de `$.state`.
- [x] Lógica pura (`hooks/lib/`) separada del registro de hooks, para probarla sin motor.
- [x] Spike runtime cerrado: el mod corre en una sesión logueada.

### v0.2 — núcleo sobre el desglose real
- [x] Costo por server desde `$.session.usage({ breakdown: 'summary' })`: el mismo desglose de `/context`, sin requests extra. Se retira el estimador `chars/4 + 150`.
- [x] Cargado vs diferido: un server tras ToolSearch cuesta 0 por request y se muestra así.
- [x] Inventario completo: conectores de claude.ai y servers de plugins aparecen aunque no estén en ningún config.
- [x] Scopes corregidos: `projects[cwd]` de `~/.claude.json` es `local`; `.mcp.json` es `project`.
- [x] Llamadas con error contadas aparte.

### v0.3 — historial
- [x] Cada sesión con al menos un turno se guarda en `$.store` (30 días, 200 sesiones).
- [x] `CANDIDATO` exige evidencia: sin uso en 3+ sesiones. Antes de eso, `OBSERVAR`.
- [x] `OCASIONAL`: sin uso ahora, pero usado en otras sesiones; nunca se propone quitarlo.
- [x] Los contadores de la sesión viven en `$.state`: sobreviven a un hot reload.
- [x] `/diet reset`.

### v0.4 — más allá de MCP
- [x] Skills: todas las de la sesión (plugins, integradas, sincronizadas), no solo las de `~/.claude/skills`. Veredicto por plugin; una a una las propias; las integradas y sincronizadas se muestran como `FIJO`.
- [x] Costo de skills = su línea en el listado, no el `SKILL.md` completo.
- [x] Agentes con tokens y usos; archivos de memoria con los pesados marcados.
- [x] Pronóstico: overhead fijo vs conversación, margen hasta la compactación y turnos restantes según el ritmo medido.

### v1.0 — en vivo
- [x] Panel (`/diet panel`) que se redibuja solo cuando cambia el reporte.
- [x] Línea de estado actualizada al cerrar cada turno y con cada `session.measure`; `/diet status on|off`.

### v1.1 — presentación
- [x] `/diet` se dibuja como etiqueta nutricional: una cifra al frente, barra fijo / conversación / libre, de qué está hecho el fijo, colores por veredicto y barras proporcionales.
- [x] Servers de la app y de plugins agregados en una línea y marcados `FIJO`: no tapan los propios ni se proponen para quitar.
- [x] Lo diferido, en una línea; el detalle completo con `/diet --all`.
- [x] Nombres legibles para conectores (`Claude Docs (claude.ai)` en vez de un id). Los que la app de escritorio solo da por id, el motor no los nombra: se muestran con sus tools (`conector 1a59c906 (batch, guide, read…)`).
- [x] La línea de estado se reemplaza por una banda sobre el prompt que solo aparece cuando hay algo que hacer; `/diet banda on|off`.
- [x] Tests en `tests/`, la carpeta que el motor incluye en su `tsconfig`.

### v1.2 — rediseño del panel
- [x] Tablero en monoespaciado: un recuadro de color por tema, filas con puntos guía, una sola barra fijo / conversación / libre y leyenda de colores.
- [x] Panel más corto: resumen por defecto, lo de la app en una línea, cabeceras que pliegan su recuadro (ACCIONES empieza plegado).
- [x] «Cuánto te queda» con espacio libre, gasto por turno y turnos restantes.
- [x] La banda sobre el prompt pasa a ser por demanda (`/diet status on`) y trae una × para cerrarla.
- [x] `/diet help` en tablas: comandos y cómo leer los veredictos.

## Siguiente

### v1.3 — validar con uso real
- [ ] Usarlo una semana: los veredictos necesitan 3+ sesiones reales. Ajustar `MIN_SESSIONS` y el umbral de memoria pesada con esos datos.
- [ ] QA visual de la etiqueta, el panel y la banda en terminal y en la app de escritorio (hoy solo los cubren los tests del árbol).
- [ ] En escritorio, probar la barra como `Svg` en vez de caracteres de bloque.
- [ ] `/diet --full`: desglose contado con la API de tokens, para comparar contra el estimado local.
- [ ] Avisar cuando `/diet` corre antes de que terminen de conectar los servers MCP.

### v1.3 — de diagnóstico a tratamiento
- [ ] Dieta opt-in: un hook `tool.describe` que difiere (`isDeferred: true`) las tools cargadas de servers `OCASIONAL`. Ahorra sin desinstalar nada.
- [ ] Detalle por tool dentro de un server (qué tools concretas se usan).
- [ ] Atribuir servers MCP a su plugin: hoy van al grupo de la app aunque el plugin se pueda desactivar.
- [ ] Historial por proyecto: un server puede ser inútil aquí y esencial en otro repo.

### Publicación
- [ ] Ícono (`claude plugin validate` lo pide para el directorio).
- [ ] Textos en inglés, o idioma configurable con `userConfig`.
- [x] CI que corra `claude plugin validate` y `claude plugin test`.

## Principios

- Medir tokens no debe agregar tokens: el mod no registra tools, skills ni secciones de prompt.
- Nada se desactiva solo. El reporte da el comando; la persona decide.
- Sin evidencia no hay veredicto.
- De los configs solo se leen nombres de servers: nunca `env`, `headers` ni argumentos.
