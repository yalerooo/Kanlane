# Pruebas de las reglas de Firestore

Comprueban `firestore.rules` contra el emulador de Firestore: que un proyecto de equipo solo lo lea y escriba quien debe, que las invitaciones solo las use su destinatario con el rol invitado, y que los proyectos personales sigan cerrados a los demás.

Necesitan **Java 11 o superior** y Node.

```bash
cd tests/rules
npm install
npx firebase emulators:exec --only firestore --project demo-workhub --config ../../firebase.json "node rules-test.js"
```

`firebase-tools` va fijada a la 13.x porque las versiones nuevas piden Java 21. Si tienes Java 21, puedes usar la última.

Al final imprime cuántas comprobaciones pasan y falla con código distinto de cero si alguna no. Los mensajes `PERMISSION_DENIED` que salen por el camino son las pruebas de lo que **debe** rechazarse.
