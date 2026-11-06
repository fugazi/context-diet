// Context Diet — spike de la API de mods.
// Objetivo: descubrir qué devuelven `$.session.usage()` y los eventos
// relevantes antes de diseñar el MVP. Escribe un JSON en el cwd de la sesión.

let report = {
  startedAt: new Date().toISOString(),
  events: {},
  usage: null,
  usageError: null,
  usageBreakdown: null,
  usageBreakdownError: null,
  tools: {},
  skills: []
};

async function flush($) {
  try {
    const cwd = await $.session.cwd();
    await $.fs.write(`${cwd}/.context-diet-spike.json`, JSON.stringify(report, null, 2));
  } catch {
    // El spike no debe romper la sesión si falla la escritura.
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    report.events['session.start'] = Object.keys(e).sort();

    try {
      report.usage = await $.session.usage();
    } catch (err) {
      report.usageError = String(err);
    }

    try {
      report.usageBreakdown = await $.session.usage({ breakdown: true });
    } catch (err) {
      report.usageBreakdownError = String(err);
    }

    await flush($);
    return next(e);
  });

  on('tool.call', async ($, e, next) => {
    const name = String(e.tool ?? 'unknown');
    report.tools[name] = (report.tools[name] ?? 0) + 1;
    report.events['tool.call'] = Object.keys(e).sort();
    await flush($);
    return next(e);
  });

  on('skill.prompt', async ($, e, next) => {
    report.skills.push({
      keys: Object.keys(e).sort(),
      skill: e.skill ?? null
    });
    await flush($);
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    report.events['turn.complete'] = Object.keys(e).sort();
    try {
      report.usage = await $.session.usage();
    } catch {
      // Conservamos la última lectura disponible.
    }
    await flush($);
    return next(e);
  });
}
