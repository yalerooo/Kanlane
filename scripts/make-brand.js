#!/usr/bin/env node
/* Marca de Kanlane: Sumi, el pulpo de los tres carriles. Genera los SVG de la marca
   (docs/marca/svg/) y el favicon (assets/img/favicon.svg) a partir de la única definición
   de la forma, src/views/sumi.js, para que el símbolo, sus gestos y la aplicación no se
   desajusten.

     node scripts/make-brand.js
     node scripts/make-icons.js     (los PNG de la aplicación instalable)

   Lo generado se guarda en el repositorio. Para cambiar el dibujo se cambia sumi.js y se
   vuelven a ejecutar los dos; los SVG no se retocan a mano. Las normas de uso están en
   docs/marca/cuaderno-sumi.html. */
'use strict';
const fs = require('fs');
const path = require('path');
const sumi = require('../src/views/sumi.js');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs/marca/svg');

const GRAFITO = '#18181B', BLANCO = '#FFFFFF', NIEBLA = '#F4F4F5';
const TITULO = 'Kanlane';

/* Sobre claro: Sumi blanco en cuadrado grafito. Sobre oscuro: Sumi grafito en cuadrado niebla.
   Sin fondo, una tinta y los ojos recortados: asoma lo que haya detrás. */
const oscuro = (o) => sumi.svg(Object.assign({bg: GRAFITO, body: BLANCO, eye: GRAFITO, title: TITULO}, o));
const claro = (o) => sumi.svg(Object.assign({bg: NIEBLA, body: GRAFITO, eye: NIEBLA, title: TITULO}, o));
const suelto = (tinta, o) => sumi.svg(Object.assign({body: tinta, title: TITULO}, o));

const files = {
  'sumi.svg': oscuro(),
  'sumi-claro.svg': claro(),
  'sumi-sin-fondo.svg': suelto(GRAFITO),
  'sumi-sin-fondo-blanco.svg': suelto(BLANCO),
  'sumi-reducido.svg': oscuro({mini: true}),
  'sumi-reducido-claro.svg': claro({mini: true}),
  'sumi-reducido-sin-fondo.svg': suelto(GRAFITO, {mini: true}),
  'sumi-reducido-sin-fondo-blanco.svg': suelto(BLANCO, {mini: true})
};
/* Un archivo por gesto, con el nombre del gesto. Solo para dentro del producto. */
sumi.MOODS.slice(1).forEach((m) => { files['sumi-' + m + '.svg'] = suelto(GRAFITO, {mood: m, title: 'Sumi, ' + m}); });

/* Los tres carriles, sin Sumi: los largos de sus brazos por debajo del cuerpo. */
const g = sumi.geometry(false);
files['carriles.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 24" role="img" aria-label="Tres carriles" fill="' + GRAFITO + '">' +
  g.arms.map((a) => '<rect x="' + (a[0] - g.x0) + '" y="0" width="' + a[1] + '" height="' + (a[2] - g.top) + '" rx="' + a[1] / 2 + '"/>').join('') + '</svg>';

fs.mkdirSync(out, {recursive: true});
Object.keys(files).forEach((name) => fs.writeFileSync(path.join(out, name), files[name] + '\n'));

/* El favicon es la versión reducida: se ve a 16 y 32 px. */
fs.writeFileSync(path.join(root, 'assets/img/favicon.svg'), files['sumi-reducido.svg'] + '\n');

console.log('docs/marca/svg: ' + Object.keys(files).length + ' SVG; assets/img/favicon.svg');
