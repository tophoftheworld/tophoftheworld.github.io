(() => {
  const GAME_WIDTH = 1100;
  const GAME_HEIGHT = 680;
  const ROUND_DURATION_SEC = 120;
  const QUEUE_MAX = 4;
  const CUSTOMER_SPAWN_INTERVAL_SEC = 5.5;

  const DRINKS = [
    {
      id: "matcha-latte",
      name: "Matcha Latte",
      recipe: ["Scoop", "Whisk", "Pour Milk"],
      baseReward: 16
    },
    {
      id: "usucha",
      name: "Usucha",
      recipe: ["Scoop", "Whisk", "Pour Water"],
      baseReward: 13
    },
    {
      id: "iced-matcha",
      name: "Iced Matcha",
      recipe: ["Scoop", "Pour Ice", "Pour Water"],
      baseReward: 15
    }
  ];

  class MatchaMvpScene extends Phaser.Scene {
    constructor() {
      super("matcha-mvp");
      this.customers = [];
      this.queueSpots = [];
      this.stations = {};
      this.currentOrder = null;
      this.completedDrink = null;
      this.recipeProgress = 0;
      this.cash = 0;
      this.combo = 0;
      this.satisfaction = 100;
      this.timeLeft = ROUND_DURATION_SEC;
      this.roundOver = false;
      this.lastSpawnSec = -999;
      this.customerSequence = 0;
      this.servedCount = 0;
      this.failedCount = 0;
      this.awaitingTimingInput = false;
      this.stepMeterX = 0;
      this.stepMeterSpeed = 300;
      this.activeStep = null;
      this.nearStationKey = null;
      this.nearStationLabel = "";
    }

    create() {
      this.drawMap();
      this.createQueue();
      this.createStations();
      this.createBarista();
      this.createHud();
      this.createMiniGameUi();
      this.createSummaryOverlay();
      this.bindInputs();
      this.syncOrderFromQueue();
      this.updateHud();
    }

    update(_, delta) {
      if (this.roundOver) {
        return;
      }
      const dt = delta / 1000;

      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.endRound();
        return;
      }

      this.handleMovement(dt);
      this.spawnCustomersIfNeeded();
      this.updateCustomers(dt);
      this.updateStationProximity();
      this.updateMiniGameMeter(dt);
      this.fadePrompt(dt);
      this.updateHud();
    }

    drawMap() {
      this.cameras.main.setBackgroundColor("#edf8ee");
      this.add.rectangle(550, 350, 1060, 620, 0xd7ebd9).setStrokeStyle(3, 0x3e6643);
      this.add.rectangle(260, 470, 430, 250, 0xeaf5eb).setStrokeStyle(2, 0x6d956f);
      this.add.rectangle(805, 470, 510, 250, 0xf6f3e7).setStrokeStyle(2, 0x9f9d87);
      this.add.rectangle(550, 290, 860, 22, 0x437b57);

      this.add.text(34, 26, "Matcha Cafe Tycoon - Kiosk Shift", {
        fontFamily: "Arial",
        fontSize: "30px",
        color: "#1d4228",
        fontStyle: "bold"
      });
      this.add.text(34, 64, "WASD move, E interact. Complete recipe steps then serve.", {
        fontFamily: "Arial",
        fontSize: "20px",
        color: "#2f5f3d"
      });
      this.add.text(122, 320, "QUEUE LANE", {
        fontFamily: "Arial",
        fontSize: "20px",
        color: "#3d6644",
        fontStyle: "bold"
      });
      this.add.text(655, 320, "PREP ZONE", {
        fontFamily: "Arial",
        fontSize: "20px",
        color: "#665f3d",
        fontStyle: "bold"
      });
    }

    createQueue() {
      const baseX = 120;
      const y = 580;
      for (let i = 0; i < QUEUE_MAX; i += 1) {
        const x = baseX + (i * 88);
        this.add.circle(x, y, 30, 0xc4d8c4).setStrokeStyle(2, 0x5d825f);
        this.queueSpots.push({ x, y });
      }
    }

    createStations() {
      this.stations = {
        orderDesk: this.createStation("Order Desk", "order", 460, 252, 150, 70, 0xe8e2bc),
        scoop: this.createStation("Scoop", "Scoop", 640, 430, 130, 82, 0x8dbe7b),
        whisk: this.createStation("Whisk", "Whisk", 805, 430, 130, 82, 0xddb560),
        water: this.createStation("Water", "Pour Water", 970, 430, 130, 82, 0x71a9d8),
        milk: this.createStation("Milk", "Pour Milk", 640, 560, 130, 82, 0xdacfc1),
        ice: this.createStation("Ice", "Pour Ice", 805, 560, 130, 82, 0xbcdff2),
        serve: this.createStation("Serve Counter", "serve", 970, 560, 130, 82, 0x3f7e53)
      };
    }

    createStation(label, key, x, y, w, h, color) {
      const rect = this.add.rectangle(x, y, w, h, color).setStrokeStyle(2, 0x27492d);
      const text = this.add.text(x - (w / 2) + 12, y - 10, label, {
        fontFamily: "Arial",
        fontSize: "22px",
        color: key === "serve" ? "#ffffff" : "#1f3926",
        fontStyle: "bold"
      });
      const zone = new Phaser.Geom.Rectangle(x - (w / 2), y - (h / 2), w, h);
      return { key, label, x, y, rect, text, zone };
    }

    createBarista() {
      this.barista = this.add.circle(560, 350, 20, 0x2a4f91).setStrokeStyle(3, 0xffffff);
      this.baristaShadow = this.add.ellipse(560, 374, 30, 12, 0x557698, 0.35);
      this.physics.world.setBounds(20, 140, 1060, 510);
      this.moveSpeed = 270;
      this.cursors = this.input.keyboard.addKeys("W,A,S,D");
      this.interactKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    }

    createHud() {
      this.add.rectangle(550, 120, 1040, 90, 0xffffff).setStrokeStyle(2, 0x8eae91);
      this.orderText = this.add.text(50, 95, "", {
        fontFamily: "Arial",
        fontSize: "30px",
        color: "#1b3e25",
        fontStyle: "bold"
      });
      this.recipeText = this.add.text(50, 132, "", {
        fontFamily: "Arial",
        fontSize: "20px",
        color: "#315f3e"
      });
      this.statsText = this.add.text(560, 95, "", {
        fontFamily: "Arial",
        fontSize: "30px",
        color: "#2b5637"
      });
      this.timerText = this.add.text(960, 95, "", {
        fontFamily: "Arial",
        fontSize: "42px",
        color: "#8b2d2d",
        fontStyle: "bold"
      });
      this.promptText = this.add.text(500, 220, "", {
        fontFamily: "Arial",
        fontSize: "26px",
        color: "#735316",
        fontStyle: "bold"
      });
      this.stepHintText = this.add.text(50, 172, "", {
        fontFamily: "Arial",
        fontSize: "22px",
        color: "#534f30",
        fontStyle: "bold"
      });
      this.feedbackText = this.add.text(560, 172, "", {
        fontFamily: "Arial",
        fontSize: "22px",
        color: "#2d633f",
        fontStyle: "bold"
      });
    }

    createMiniGameUi() {
      this.minigamePanel = this.add.rectangle(550, 250, 480, 28, 0xeae4c0).setStrokeStyle(2, 0x918457).setVisible(false);
      this.minigameGoodZone = this.add.rectangle(550, 250, 110, 24, 0x93cd88).setVisible(false);
      this.minigameNeedle = this.add.rectangle(420, 250, 12, 32, 0x26443a).setVisible(false);
      this.minigameText = this.add.text(356, 218, "", {
        fontFamily: "Arial",
        fontSize: "20px",
        color: "#4a472e",
        fontStyle: "bold"
      }).setVisible(false);
    }

    createSummaryOverlay() {
      this.summaryPanel = this.add.rectangle(550, 350, 680, 380, 0x152d1d, 0.95)
        .setStrokeStyle(3, 0x95c29a)
        .setVisible(false);
      this.summaryText = this.add.text(265, 210, "", {
        fontFamily: "Arial",
        fontSize: "34px",
        color: "#ebffec"
      }).setVisible(false);
    }

    bindInputs() {
      this.input.keyboard.on("keydown-E", () => this.handleInteractPress());
    }

    handleMovement(dt) {
      let vx = 0;
      let vy = 0;
      if (this.cursors.A.isDown) {
        vx -= 1;
      }
      if (this.cursors.D.isDown) {
        vx += 1;
      }
      if (this.cursors.W.isDown) {
        vy -= 1;
      }
      if (this.cursors.S.isDown) {
        vy += 1;
      }

      const mag = Math.hypot(vx, vy) || 1;
      vx = (vx / mag) * this.moveSpeed * dt;
      vy = (vy / mag) * this.moveSpeed * dt;

      this.barista.x = Phaser.Math.Clamp(this.barista.x + vx, 30, GAME_WIDTH - 30);
      this.barista.y = Phaser.Math.Clamp(this.barista.y + vy, 160, GAME_HEIGHT - 30);
      this.baristaShadow.x = this.barista.x;
      this.baristaShadow.y = this.barista.y + 22;
    }

    handleInteractPress() {
      if (this.roundOver) {
        return;
      }
      if (this.awaitingTimingInput) {
        this.resolveTimingHit();
        return;
      }
      if (!this.nearStationKey) {
        this.flashFeedback("Move close to a station first.", true);
        return;
      }

      if (this.nearStationKey === "order") {
        this.tryAcceptOrder();
      } else if (this.nearStationKey === "serve") {
        this.tryServe();
      } else {
        this.tryStartStep(this.nearStationKey);
      }
    }

    updateStationProximity() {
      let nearest = null;
      let nearestDist = 9999;
      Object.values(this.stations).forEach((station) => {
        const dist = Phaser.Math.Distance.Between(this.barista.x, this.barista.y, station.x, station.y);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = station;
        }
        station.rect.setStrokeStyle(2, 0x27492d);
      });
      if (nearest && nearestDist < 90) {
        this.nearStationKey = nearest.key;
        this.nearStationLabel = nearest.label;
        nearest.rect.setStrokeStyle(4, 0xfef4a9);
        if (!this.awaitingTimingInput) {
          this.promptText.setText(`[E] ${nearest.label}`);
          this.promptText.alpha = 1;
        }
      } else {
        this.nearStationKey = null;
        this.nearStationLabel = "";
        if (!this.awaitingTimingInput) {
          this.promptText.setText("");
        }
      }
    }

    spawnCustomersIfNeeded() {
      const elapsed = ROUND_DURATION_SEC - this.timeLeft;
      if (this.customers.length >= QUEUE_MAX) {
        return;
      }
      if ((elapsed - this.lastSpawnSec) < CUSTOMER_SPAWN_INTERVAL_SEC) {
        return;
      }
      this.lastSpawnSec = elapsed;
      this.spawnCustomer();
    }

    spawnCustomer() {
      const order = Phaser.Utils.Array.GetRandom(DRINKS);
      const patienceMax = Phaser.Math.Between(22, 34);
      const customer = {
        id: `c${this.customerSequence}`,
        order,
        patience: patienceMax,
        patienceMax,
        accepted: false,
        sprite: null,
        label: null,
        barBg: null,
        barFill: null
      };
      this.customerSequence += 1;

      const color = Phaser.Display.Color.GetColor(
        Phaser.Math.Between(85, 210),
        Phaser.Math.Between(120, 220),
        Phaser.Math.Between(95, 190)
      );
      customer.sprite = this.add.circle(60, 580, 24, color).setStrokeStyle(2, 0x27402b);
      customer.label = this.add.text(35, 608, order.name.split(" ")[0], {
        fontFamily: "Arial",
        fontSize: "14px",
        color: "#173523"
      });
      customer.barBg = this.add.rectangle(60, 552, 54, 7, 0x7f9f87);
      customer.barFill = this.add.rectangle(60, 552, 54, 7, 0x4eb069);

      this.customers.push(customer);
      this.refreshCurrentOrder();
    }

    updateCustomers(dt) {
      for (let i = 0; i < this.customers.length; i += 1) {
        const customer = this.customers[i];
        const target = this.queueSpots[i];
        customer.sprite.x = Phaser.Math.Linear(customer.sprite.x, target.x, 0.11);
        customer.sprite.y = Phaser.Math.Linear(customer.sprite.y, target.y, 0.11);
        customer.label.x = customer.sprite.x - 24;
        customer.label.y = customer.sprite.y + 26;
        customer.barBg.x = customer.sprite.x;
        customer.barBg.y = customer.sprite.y - 30;
        customer.barFill.y = customer.barBg.y;

        customer.patience -= dt * (i === 0 ? 1.15 : 0.68);
        const ratio = Phaser.Math.Clamp(customer.patience / customer.patienceMax, 0, 1);
        customer.barFill.width = 54 * ratio;
        customer.barFill.x = customer.sprite.x - ((54 - customer.barFill.width) / 2);
        customer.barFill.fillColor = ratio > 0.5 ? 0x4eb069 : ratio > 0.25 ? 0xd0b14c : 0xbe4747;
      }

      while (this.customers.length > 0 && this.customers[0].patience <= 0) {
        const leaving = this.customers.shift();
        this.destroyCustomerVisuals(leaving);
        this.failedCount += 1;
        this.combo = 0;
        this.satisfaction = Math.max(0, this.satisfaction - 12);
        this.cash = Math.max(0, this.cash - 4);
        this.resetDrinkProgress();
        this.flashFeedback("Customer rage quit. Too slow.", true);
      }

      this.refreshCurrentOrder();
    }

    tryAcceptOrder() {
      if (!this.customers.length) {
        this.flashFeedback("No one in line.", true);
        return;
      }
      if (this.customers[0].accepted) {
        this.flashFeedback("Order already accepted. Start crafting.", false);
        return;
      }
      this.customers[0].accepted = true;
      this.resetDrinkProgress();
      this.flashFeedback(`Accepted: ${this.customers[0].order.name}`, false);
      this.refreshCurrentOrder();
    }

    tryStartStep(stepName) {
      const front = this.customers[0];
      if (!front || !front.accepted) {
        this.flashFeedback("Take the order at the counter first.", true);
        return;
      }
      if (this.completedDrink) {
        this.flashFeedback("Drink is done. Serve it now.", false);
        return;
      }
      const expected = front.order.recipe[this.recipeProgress];
      if (stepName !== expected) {
        this.combo = 0;
        this.satisfaction = Math.max(0, this.satisfaction - 4);
        this.flashFeedback(`Wrong station. Need: ${expected}`, true);
        return;
      }
      this.startTimingMiniGame(stepName);
    }

    startTimingMiniGame(stepName) {
      this.awaitingTimingInput = true;
      this.activeStep = stepName;
      this.stepMeterX = Phaser.Math.Between(-210, 210);
      this.stepMeterSpeed = Phaser.Math.Between(260, 360) * (Math.random() > 0.5 ? 1 : -1);

      this.minigamePanel.setVisible(true);
      this.minigameGoodZone.setVisible(true);
      this.minigameNeedle.setVisible(true);
      this.minigameText.setVisible(true).setText(`Hit E in green for ${stepName}`);
      this.promptText.setText("Press E to stop the needle");
    }

    updateMiniGameMeter(dt) {
      if (!this.awaitingTimingInput) {
        return;
      }
      this.stepMeterX += this.stepMeterSpeed * dt;
      if (this.stepMeterX > 228 || this.stepMeterX < -228) {
        this.stepMeterSpeed *= -1;
      }
      this.minigameNeedle.x = 550 + this.stepMeterX;
    }

    resolveTimingHit() {
      const inGreenZone = Math.abs(this.stepMeterX) < 52;
      this.awaitingTimingInput = false;
      this.minigamePanel.setVisible(false);
      this.minigameGoodZone.setVisible(false);
      this.minigameNeedle.setVisible(false);
      this.minigameText.setVisible(false);

      if (!inGreenZone) {
        this.combo = 0;
        this.satisfaction = Math.max(0, this.satisfaction - 5);
        this.flashFeedback(`${this.activeStep} botched. Try again.`, true);
        this.activeStep = null;
        return;
      }

      this.recipeProgress += 1;
      this.flashFeedback(`${this.activeStep} perfect!`, false);
      this.activeStep = null;
      const front = this.customers[0];
      if (front && this.recipeProgress >= front.order.recipe.length) {
        this.completedDrink = front.order;
        this.flashFeedback(`Drink ready: ${front.order.name}. Serve it.`, false);
      }
      this.refreshCurrentOrder();
    }

    tryServe() {
      const front = this.customers[0];
      if (!front || !front.accepted) {
        this.flashFeedback("Take an order first.", true);
        return;
      }
      if (!this.completedDrink) {
        this.flashFeedback("Drink not finished.", true);
        return;
      }
      if (this.completedDrink.id !== front.order.id) {
        this.failedCount += 1;
        this.combo = 0;
        this.satisfaction = Math.max(0, this.satisfaction - 10);
        this.cash = Math.max(0, this.cash - 6);
        this.resetDrinkProgress();
        this.flashFeedback("Wrong drink served.", true);
        return;
      }

      const patienceRatio = Phaser.Math.Clamp(front.patience / front.patienceMax, 0, 1);
      const speedBonus = Math.ceil(patienceRatio * 8);
      this.combo += 1;
      const comboBonus = Math.min(this.combo, 10);
      const payout = front.order.baseReward + speedBonus + comboBonus;
      this.cash += payout;
      this.satisfaction = Math.min(100, this.satisfaction + 3);
      this.servedCount += 1;

      const servedCustomer = this.customers.shift();
      this.destroyCustomerVisuals(servedCustomer);
      this.resetDrinkProgress();
      this.flashFeedback(`Served ${front.order.name} +$${payout}`, false);
      this.refreshCurrentOrder();
    }

    destroyCustomerVisuals(customer) {
      customer.sprite.destroy();
      customer.label.destroy();
      customer.barBg.destroy();
      customer.barFill.destroy();
    }

    resetDrinkProgress() {
      this.recipeProgress = 0;
      this.completedDrink = null;
    }

    refreshCurrentOrder() {
      const front = this.customers[0] || null;
      this.currentOrder = front && front.accepted ? front.order : null;

      if (!front) {
        this.orderText.setText("Current Order: none");
        this.recipeText.setText("Recipe: waiting for customer...");
        this.stepHintText.setText("");
        return;
      }

      if (!front.accepted) {
        this.orderText.setText(`Front Customer: ${front.order.name}`);
        this.recipeText.setText("Press E at Order Desk to accept");
        this.stepHintText.setText("");
        return;
      }

      this.orderText.setText(`Current Order: ${front.order.name}`);
      this.recipeText.setText(this.formatRecipe(front.order.recipe));
      const expected = front.order.recipe[this.recipeProgress];
      if (this.completedDrink) {
        this.stepHintText.setText("Drink complete. Go to Serve Counter and press E.");
      } else {
        this.stepHintText.setText(`Next Step: ${expected}`);
      }
    }

    formatRecipe(recipe) {
      return recipe.map((step, i) => {
        if (i < this.recipeProgress) {
          return `[x] ${step}`;
        }
        return `[ ] ${step}`;
      }).join(" -> ");
    }

    flashFeedback(message, isError) {
      this.feedbackText.setText(message);
      this.feedbackText.setColor(isError ? "#a22d2d" : "#2f6d41");
      this.feedbackText.alpha = 1;
    }

    fadePrompt(dt) {
      if (this.feedbackText.text) {
        this.feedbackText.alpha = Phaser.Math.Clamp(this.feedbackText.alpha - dt * 0.2, 0.4, 1);
      }
      if (this.promptText.text && !this.awaitingTimingInput) {
        this.promptText.alpha = Phaser.Math.Clamp(this.promptText.alpha - dt * 0.25, 0.5, 1);
      }
    }

    updateHud() {
      this.statsText.setText(`Queue: ${this.customers.length}/${QUEUE_MAX}   Cash: $${this.cash}   Satisf: ${Math.round(this.satisfaction)}%   Combo: x${this.combo}`);
      this.timerText.setText(`${Math.ceil(this.timeLeft)}s`);
    }

    endRound() {
      this.roundOver = true;
      this.awaitingTimingInput = false;
      this.summaryPanel.setVisible(true);
      this.summaryText.setVisible(true);
      this.summaryText.setText([
        "Shift Over",
        "",
        `Cash: $${this.cash}`,
        `Served: ${this.servedCount}`,
        `Lost: ${this.failedCount}`,
        `Satisfaction: ${Math.round(this.satisfaction)}%`,
        "",
        "Refresh to play again."
      ].join("\n"));
      this.promptText.setText("");
      this.flashFeedback("Round ended.", false);
    }
  }

  const config = {
    type: Phaser.AUTO,
    parent: "game-root",
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: "#f4f9f2",
    scene: [MatchaMvpScene]
  };

  new Phaser.Game(config);
})();
