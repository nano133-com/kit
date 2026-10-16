// Call these functions from authenticated, rate-limited routes. Supply the real database and sender.
import { startRound, checkRound, payPrize } from "@nano133/three/server";
import { rules } from "./run.js";

export function coinRunServer({ store, sender, amountRaw, limits }) {
  return {
    // `player` is { id, payee } from the server's verified session, never a request body.
    start(player) {
      return startRound(store, { rulesVersion: rules.version, player });
    },
    async end(player, roundId, inputs) {
      const round = await store.transaction((tx) => tx.getRound(roundId));
      if (!round || round.player.id !== player.id || round.player.payee !== player.payee) return { state: "unknown" };
      if (round.status === "open") {
        const checked = await checkRound(store, { roundId, inputs });
        if (checked.state !== "checked" && checked.state !== "used") return checked;
      }
      // A retry after a failed publication uses the saved block. It does not replay or sign again.
      return payPrize(store, sender, { roundId, payee: player.payee, amountRaw, limits });
    },
  };
}
