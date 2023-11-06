import { Manager } from "../../manager.js";
import { JSON_MESSAGE } from "../../@types/Websocket.js";

export default {
  name: "resume",
  run: async (client: Manager, json: JSON_MESSAGE, ws: WebSocket) => {
    const player = client.manager.players.get(json.guild);

    if (!player)
      return ws.send(
        JSON.stringify({ error: "0x100", message: "No player on this guild" })
      );
    player.pause(false);

    ws.send(JSON.stringify({ guild: player.guildId, op: "resume_track" }));
  },
};
