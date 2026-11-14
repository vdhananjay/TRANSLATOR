const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const pageUrl = pathToFileURL(path.join(__dirname, "dom-splice-example.html")).href;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__speechRecognitionInstances = [];
    window.__openedUrls = [];

    class MockSpeechRecognition {
      constructor() {
        this.continuous = false;
        this.interimResults = false;
        this.maxAlternatives = 1;
        window.__speechRecognitionInstances.push(this);
      }

      start() {
        this.onstart?.();
      }

      stop() {
        this.onend?.();
      }
    }

    class MockSpeechSynthesisUtterance {
      constructor(text) {
        this.text = text;
      }
    }

    window.SpeechRecognition = MockSpeechRecognition;
    window.webkitSpeechRecognition = MockSpeechRecognition;
    window.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [{ lang: "pa-IN", name: "Punjabi test voice" }],
        cancel() {},
        speak(utterance) {
          this.lastUtterance = utterance;
          utterance.onstart?.();
          utterance.onend?.();
        }
      }
    });
    window.open = url => {
      window.__openedUrls.push(url);
      return { opener: null };
    };
  });

  await page.route("https://www.gstatic.com/**", route => route.abort());
  await page.route("https://translate.googleapis.com/**", async route => {
    const requestUrl = new URL(route.request().url());
    const language = requestUrl.searchParams.get("tl");
    const text = requestUrl.searchParams.get("q") || "";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([[[`[${language}] ${text}`]]])
    });
  });

  await page.goto(pageUrl);
  await page.getByRole("button", { name: "Continue as guest" }).click();
});

test("paragraph API objects, splice behavior, updates, and invalid inputs", async ({ page }) => {
  const result = await page.evaluate(() => {
    const staticParagraph = window.createParagraph("static paragraph");
    window.insertParagraphAt(1, staticParagraph.textContent);
    const helperInserted = window.paragraphElements[1].textContent;
    const helperRemoved = window.removeParagraphAt(1);
    const created = window.createParagraph("scroll me", "scrolling");
    window.spliceParagraphs(1, 0, created);
    const orderAfterInsert = window.paragraphElements.map(element => element.textContent);
    const updated = window.updateParagraphAt(1, "updated paragraph");
    const updatedText = window.paragraphElements[1].textContent;
    const removed = window.spliceParagraphs(1, 1);
    const removeAtExisting = window.removeParagraphAt(1);
    const invalidUpdate = window.updateParagraphAt(99, "missing");
    const invalidRemove = window.removeParagraphAt(99);

    let invalidDisplayMode;
    let invalidInsertedElement;
    let invalidDeleteCount;
    try { window.createParagraph("bad", "blink"); } catch (error) { invalidDisplayMode = error.name; }
    try { window.spliceParagraphs(0, 0, document.createElement("div")); } catch (error) { invalidInsertedElement = error.name; }
    try { window.spliceParagraphs(0, -1); } catch (error) { invalidDeleteCount = error.name; }

    return {
      globalReferencesMatch: window.domElements.p1 === window.paragraphElements[0],
      staticParagraphText: staticParagraph.textContent,
      staticParagraphDoesNotScroll: !staticParagraph.classList.contains("is-scrolling"),
      helperInserted,
      helperRemoved,
      scrollingClass: created.classList.contains("is-scrolling"),
      orderAfterInsert,
      updated,
      updatedText,
      removed: removed[0].textContent,
      removeAtExisting,
      invalidUpdate,
      invalidRemove,
      invalidDisplayMode,
      invalidInsertedElement,
      invalidDeleteCount
    };
  });

  expect(result.globalReferencesMatch).toBe(true);
  expect(result.staticParagraphText).toBe("static paragraph");
  expect(result.staticParagraphDoesNotScroll).toBe(true);
  expect(result.helperInserted).toBe("static paragraph");
  expect(result.helperRemoved).toBe(true);
  expect(result.scrollingClass).toBe(true);
  expect(result.orderAfterInsert).toEqual(["P1: First paragraph", "scroll me", "P2: Second paragraph"]);
  expect(result.updated).toBe(true);
  expect(result.updatedText).toBe("updated paragraph");
  expect(result.removed).toBe("updated paragraph");
  expect(result.removeAtExisting).toBe(true);
  expect(result.invalidUpdate).toBe(false);
  expect(result.invalidRemove).toBe(false);
  expect(result.invalidDisplayMode).toBe("TypeError");
  expect(result.invalidInsertedElement).toBe("TypeError");
  expect(result.invalidDeleteCount).toBe("RangeError");
  await page.locator("#p1-text").fill("Updated P1");
  await page.getByRole("button", { name: "Update P1" }).click();
  await expect(page.locator("#p1")).toHaveText("Updated P1");
  await expect(page.locator("#indexes")).toContainText("0: Updated P1");
});

test("calculator functions and buttons handle every operation", async ({ page }) => {
  const results = await page.evaluate(() => ({
    add: window.add(8, 2),
    subtract: window.subtract(8, 2),
    multiply: window.multiply(8, 2),
    divide: window.divide(8, 2),
    rejectsNonFinite: (() => {
      try { window.add(Infinity, 1); } catch (error) { return error.name; }
    })(),
    rejectsDivisionByZero: (() => {
      try { window.divide(1, 0); } catch (error) { return error.name; }
    })(),
    calculatorMatchesGlobals: window.calculator.add === window.add
  }));

  expect(results).toEqual({
    add: 10,
    subtract: 6,
    multiply: 16,
    divide: 4,
    rejectsNonFinite: "TypeError",
    rejectsDivisionByZero: "RangeError",
    calculatorMatchesGlobals: true
  });

  for (const [operation, expected] of [["add", "10"], ["subtract", "6"], ["multiply", "16"], ["divide", "4"]]) {
    await page.locator(`[data-operation="${operation}"]`).click();
    await expect(page.locator("#calculator-result")).toContainText(expected);
  }
  await page.locator("#number-b").fill("0");
  await page.locator('[data-operation="divide"]').click();
  await expect(page.locator("#calculator-result")).toContainText("Cannot divide by zero");
});

test("word-game classes, dictionary methods, and valid and invalid plays", async ({ page }) => {
  const result = await page.evaluate(() => {
    const words = [{ word: "HI", definition: "A greeting." }];
    const baseGame = new window.WordGame(words);
    const found = baseGame.findWord("HI").definition;
    baseGame.addWord("OK", "An agreement.");

    let duplicateError;
    let invalidWordError;
    let emptyDefinitionError;
    try { baseGame.addWord("hi", "Duplicate."); } catch (error) { duplicateError = error.name; }
    try { baseGame.addWord("A1", "Invalid."); } catch (error) { invalidWordError = error.name; }
    try { baseGame.addWord("YES", "   "); } catch (error) { emptyDefinitionError = error.name; }

    const game = new window.ScrabbleWordGame(window.scrabbleWords, window.scrabbleTileValues);
    game.start();
    const starterLetters = game.rack.map(tile => tile.letter).join("");
    const byLetter = letter => game.rack.find(tile => tile.letter === letter);
    for (const letter of "STAR") game.selectTile(byLetter(letter).id);
    const validPlay = game.submitWord();
    const validScore = game.score;
    const nextRackSize = game.rack.length;

    game.selectTile(game.rack[0].id);
    game.undoTile();
    game.selectTile(game.rack[0].id);
    game.clearWord();
    const invalidSelection = game.selectTile(game.rack[0].id);
    game.selectedTiles = game.rack.slice(0, 2);
    const invalidPlay = game.submitWord();

    return {
      found,
      addedWord: words[1],
      duplicateError,
      invalidWordError,
      emptyDefinitionError,
      starterLetters,
      validPlay,
      validScore,
      nextRackSize,
      invalidSelection,
      invalidPlay,
      hasBag: game.tileBag.length > 0
    };
  });

  expect(result.found).toBe("A greeting.");
  expect(result.addedWord).toEqual({ word: "OK", definition: "An agreement." });
  expect(result.duplicateError).toBe("RangeError");
  expect(result.invalidWordError).toBe("TypeError");
  expect(result.emptyDefinitionError).toBe("TypeError");
  expect(result.starterLetters).toBe("STARENLI");
  expect(result.validPlay).toMatchObject({ valid: true, word: "STAR", pointsEarned: 4 });
  expect(result.validScore).toBe(4);
  expect(result.nextRackSize).toBe(7);
  expect(result.invalidSelection).toBe(true);
  expect(result.invalidPlay.valid).toBe(false);
  expect(result.hasBag).toBe(true);
  await expect(page.locator("#tile-rack .tile")).toHaveCount(8);
});

test("word-game controls add words, clear selections, and submit a score", async ({ page }) => {
  await page.locator("#custom-word").fill("HELLO");
  await page.locator("#custom-definition").fill("A greeting.");
  await page.getByRole("button", { name: "Add word" }).click();
  await expect(page.locator("#game-message")).toContainText('Added "HELLO"');

  for (const letter of ["S", "T", "A", "R"]) {
    await page.getByRole("button", { name: new RegExp(`^${letter},`) }).first().click();
  }
  await expect(page.locator("#word-preview")).toHaveText("STAR");
  await page.getByRole("button", { name: "Submit word" }).click();
  await expect(page.locator("#game-message")).toContainText("You earned 4 points");
  await expect(page.locator("#game-score")).toHaveText("4");

  await page.getByRole("button", { name: "New game" }).click();
  await expect(page.locator("#game-score")).toHaveText("0");
  await page.getByRole("button", { name: "Clear word" }).click();
  await expect(page.locator("#game-message")).toContainText("Thank you for playing");
});

test("Punjabi manual translation, voice dictation, and audio use the selected language", async ({ page }) => {
  await page.locator("#translation-source").fill("Good morning");
  await page.locator("#translation-language").selectOption("pa");
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(page.locator("#translation-output")).toContainText("[pa] Good morning");
  await expect(page.locator("#translation-status")).toContainText("Translation complete (Punjabi)");

  await page.getByRole("button", { name: "Play translation audio" }).click();
  await expect(page.locator("#translation-status")).toContainText("Translation audio finished");
  expect(await page.evaluate(() => window.speechSynthesis.lastUtterance.lang)).toBe("pa-IN");

  await page.getByRole("button", { name: "Speak English text" }).click();
  await page.evaluate(() => {
    const recognition = window.__speechRecognitionInstances[0];
    const finalResult = Object.assign([{ transcript: "dictated phrase" }], { isFinal: true });
    recognition.onresult({ results: [finalResult] });
  });
  await expect(page.locator("#translation-source")).toHaveValue("Good morning dictated phrase");
  await expect(page.locator("#translation-count")).toContainText("28 / 10,000");
});

test("live Punjabi translation streams speech into the scrolling output", async ({ page }) => {
  await page.locator("#translation-language").selectOption("pa");
  await page.getByRole("button", { name: "Start live translation" }).click();
  await expect(page.locator("#live-translation-status")).toContainText("Listening for English speech");

  await page.evaluate(() => {
    const recognition = window.__speechRecognitionInstances[1];
    const interimResult = Object.assign([{ transcript: "live phrase" }], { isFinal: false });
    recognition.onresult({ results: [interimResult] });
  });
  await expect(page.locator("#live-translation-output")).toContainText("[pa] live phrase");
  await expect(page.locator("#live-translation-output span")).toHaveCSS("animation-name", "live-translation-scroll");

  await page.getByRole("button", { name: "Stop live translation" }).click();
  await expect(page.locator("#live-translation-status")).toHaveText("Live translation is off.");
});

test("voice commands update paragraphs, translate Punjabi, and open safe destinations", async ({ page }) => {
  const results = await page.evaluate(() => ({
    inserted: window.runVoiceCommand("insert paragraph at index 1 saying Voice inserted"),
    updated: window.runVoiceCommand("update paragraph at index 1 to Voice updated"),
    removed: window.runVoiceCommand("remove paragraph at index 1"),
    missing: window.runVoiceCommand("remove paragraph at index 99"),
    opened: window.runVoiceCommand("open example dot com"),
    searched: window.runVoiceCommand("search the web for Punjabi translation")
  }));

  expect(results).toEqual({ inserted: true, updated: true, removed: true, missing: false, opened: true, searched: true });
  await expect(page.locator("#paragraph-list > p")).toHaveCount(2);
  await expect(page.locator("#voice-status")).toContainText("web search results");
  expect(await page.evaluate(() => window.__openedUrls)).toEqual([
    "https://example.com/",
    "https://www.bing.com/search?q=Punjabi%20translation"
  ]);

  expect(await page.evaluate(() => window.runVoiceCommand("translate hello to Punjabi"))).toBe(true);
  await expect(page.locator("#translation-output")).toContainText("[pa] hello");
});

test("guest-mode functions show and hide the application", async ({ page }) => {
  await page.evaluate(() => window.exitGuestMode());
  await expect(page.locator("#app-content")).toBeHidden();
  await expect(page.locator("#auth-view")).toBeVisible();
  await page.evaluate(() => window.enterGuestMode());
  await expect(page.locator("#app-content")).toBeVisible();
  await expect(page.locator("#auth-view")).toBeHidden();
});