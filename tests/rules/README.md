# Pruebas de las reglas de Firestore

Comprueban `firestore.rules` contra el emulador de Firestore: que un proyecto de equipo solo lo lea y escriba quien debe, que las invitaciones solo las use su destinatario con el rol invitado, y que los proyectos personales sigan cerrados a los demás. Desde el PR 2 del cifrado por proyecto también comprueban que un proyecto cifrado (`enc`) no admite datos en claro ni degradar documentos sellados, que cada persona solo toca su envoltorio de clave (`crypto/{uid}`) y que la clave envuelta de una invitación solo la lee su destinatario durante 24 horas. Desde el PR 10, además: que la clave de un proyecto solo cambia por el camino previsto (empezar apuntando la anterior, terminar quitándola) y, en un equipo, solo si lo hace el propietario; que durante y después del cambio no se acepta nada sellado con la clave anterior; y que la clave pública de cada miembro (`pubkeys/{uid}`) y la clave nueva que se le entrega (`rekey/{uid}`) solo las escribe y las lee quien debe. Desde el PR 11: que a un proyecto personal que ya existe solo se le añade el cifrado marcado como en conversión (`enc.conv`), sin enlace con GitHub y con contraseña; que desde ese momento lo nuevo tiene que ir sellado; y que la conversión solo termina quitando esa marca.

Necesitan **Java 11 o superior** y Node.

```bash
cd tests/rules
npm install
npm test
```

`firebase-tools` va fijada a la 13.x porque las versiones nuevas piden Java 21. Si tienes Java 21, puedes usar la última.

Al final imprime cuántas comprobaciones pasan y falla con código distinto de cero si alguna no. Los mensajes `PERMISSION_DENIED` que salen por el camino son las pruebas de lo que **debe** rechazarse.
