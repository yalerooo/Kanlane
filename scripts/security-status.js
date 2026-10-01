/* Lectura del estado real de Firebase. Requiere las dependencias de tests/rules
   y una sesión previa de `firebase login`; no imprime credenciales ni claves. */
const auth = require('../tests/rules/node_modules/firebase-tools/lib/auth');
const scopes = require('../tests/rules/node_modules/firebase-tools/lib/scopes');

const project = 'workhub-26f50';
const number = '1056897810807';
const app = '1:1056897810807:web:dacc47f0a05651f91c6172';

(async () => {
  const account = auth.getGlobalDefaultAccount();
  if(!account) throw new Error('Inicia sesión con firebase login');
  const token = await auth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM]);
  async function read(url){
    const response = await fetch(url, {headers:{Authorization:'Bearer ' + token.access_token}});
    const data = await response.json();
    if(!response.ok) throw new Error(response.status + ' ' + (data.error?.message || 'sin detalle'));
    return data;
  }
  const [identity, appCheck, services, billing] = await Promise.all([
    read('https://identitytoolkit.googleapis.com/admin/v2/projects/' + project + '/config'),
    read('https://firebaseappcheck.googleapis.com/v1/projects/' + number + '/apps/' + app + '/recaptchaEnterpriseConfig'),
    read('https://firebaseappcheck.googleapis.com/v1/projects/' + number + '/services'),
    read('https://cloudbilling.googleapis.com/v1/projects/' + project + '/billingInfo')
  ]);
  console.log('Enumeración de correo protegida: ' + (identity.emailPrivacyConfig?.enableImprovedEmailPrivacy === true ? 'sí' : 'NO'));
  console.log('App Check registrado: ' + (appCheck.siteKey ? 'sí' : 'NO'));
  console.log('App Check obligatorio: ' + ((services.services || []).filter((service) => service.enforcementMode === 'ENFORCED').map((service) => service.name.split('/').pop()).join(', ') || 'no'));
  console.log('Facturación activada: ' + (billing.billingEnabled ? 'sí' : 'no, plan sin facturación'));
})().catch((error) => { console.error('No se pudo consultar el estado: ' + error.message); process.exitCode = 1; });
