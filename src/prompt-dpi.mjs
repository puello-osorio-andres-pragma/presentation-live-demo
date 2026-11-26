const DPI_PATTERN = /^\d{13}$/;

export function isValidDpi(value) {
  return DPI_PATTERN.test(value ?? '');
}

export function promptHidden(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    if (!input.isTTY) {
      reject(new Error('No hay terminal interactiva: define DEMO_DPI para arrancar.'));
      return;
    }
    let value = '';
    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const finish = (result, error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      output.write('\n');
      if (error) reject(error);
      else resolve(result);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish(value);
        if (char === '\u0003') return finish(null, new Error('Cancelado por el usuario'));
        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write('\b \b');
          }
        } else {
          value += char;
          output.write('*');
        }
      }
      return undefined;
    };
    input.on('data', onData);
  });
}
