# ¿Quién lo dijo? 🧊

Juego de rompe hielo para eventos. Los participantes responden preguntas desde su celular y luego intentan adivinar quién dijo cada respuesta.

## Requisitos

- [Node.js](https://nodejs.org) (versión 18 o superior)

## Instalación y arranque

```bash
cd icebreaker
npm install
npm start
```

El servidor arranca en `http://localhost:3000`

## Cómo jugar

1. **Pantalla principal** → abre `http://localhost:3000` en la pantalla compartida (proyector/TV)
2. **Jugadores** → escanean el QR o van a `http://<tu-ip>:3000/player.html` desde su celular
   - Para que funcione en red local, usa la IP de tu computadora (ej. `192.168.1.x`)
3. El host espera a que todos se unan y presiona **Iniciar Ronda**
4. Todos responden la pregunta desde su celular
5. Se muestra la fase de votación — cada jugador adivina quién dijo la primera respuesta
6. Se revelan los resultados con puntos
7. ¡Siguiente ronda!

## Puntuación

- **+1 punto** por cada persona que te adivinó correctamente
- **+2 puntos bonus** si nadie te adivinó (¡eres un misterio! 🕵️)

## Preguntas incluidas

- ¿Cuál es tu comida favorita?
- ¿A qué lugar del mundo quisieras viajar?
- ¿Cuál es tu talento oculto?
- ¿Qué harías si ganaras la lotería?
- ¿Cuál es tu película o serie favorita?
- ¿Qué superpoder elegirías?
- ¿Cuál es tu mayor miedo?
- ¿Qué canción no puedes dejar de escuchar?
- ¿Cuál es tu hobby favorito?
- ¿Qué animal serías y por qué?

Puedes agregar más en `server.js` en el arreglo `QUESTIONS`.
