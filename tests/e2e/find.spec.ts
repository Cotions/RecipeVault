import { expect, test } from "@playwright/test";

// Finding a recipe on the home page: spelling, ideas, an empty list, the phone filter sheet.

test("a misspelt word is searched as the close word, with a link to it", async ({
  page,
}) => {
  await page.goto("/?q=tarre");
  const respell = page.locator(".respell");
  await expect(respell).toContainText(
    "Résultats pour « tarte » (vous aviez tapé « tarre »)",
  );
  await expect(respell).not.toContainText("Aucune recette");
  await expect(page.locator(".summary")).toContainText("pour « tarte »");
  await expect(page.locator(".cards")).toContainText("Tarte");
  // « Chercher exactement »: the word as typed, nothing found, the close word offered.
  await respell.getByRole("link", { name: "Chercher exactement" }).click();
  await expect(page).toHaveURL(/exact=1/);
  await expect(
    page.locator(".respell").getByRole("link", { name: /tarte/ }),
  ).toHaveAttribute("href", /q=tarte/);
  await expect(page.locator(".summary")).toContainText("Aucune recette");
});

test("the home page offers ideas above the index, one row of three; « Plus d’idées » shows the rest; ↻ draws another card", async ({
  page,
}) => {
  await page.goto("/");
  const ideas = page.locator(".ideas");
  await expect(
    ideas.getByRole("heading", { name: "Des idées", level: 2 }),
  ).toBeVisible();
  await expect(
    ideas.getByRole("heading", { name: "Une fiche au hasard" }),
  ).toBeVisible();
  await expect(ideas.locator(".idea:visible")).toHaveCount(3);
  const more = ideas.getByRole("button", { name: "Plus d’idées" });
  await more.click();
  await expect(
    ideas.getByRole("button", { name: "Moins d’idées" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    ideas.getByRole("heading", { name: "Ajoutées récemment" }),
  ).toBeVisible();
  await ideas
    .getByRole("button", { name: "Une autre fiche au hasard" })
    .click();
  await expect(ideas.locator("a.pick")).toHaveAttribute("href", /^\/r\//);
  await expect(page.locator(".cards")).toBeVisible();
  await page.goto("/?q=tarte");
  await expect(page.locator(".ideas")).toHaveCount(0);
});

test("nothing found with filters on: the filters, each removable, and « Tout effacer »", async ({
  page,
}) => {
  await page.goto("/?q=pomme&tag=soupe");
  const chips = page.locator(".empty .empty-chips");
  await expect(
    chips.getByRole("link", { name: /Retirer le filtre « .*Soupe.* »/i }),
  ).toBeVisible();
  await expect(chips.getByRole("link", { name: "Tout effacer" })).toBeVisible();
  await expect(page.locator(".empty")).toContainText(
    /Sans les filtres : \d+ recettes?/,
  );
  await page.goto("/?q=zzzzzz");
  await expect(page.locator(".empty")).toContainText("Vérifiez l’orthographe");
  await expect(page.locator(".empty .empty-chips")).toHaveCount(0);
});

test("words that find nothing together are offered one at a time", async ({
  page,
}) => {
  await page.goto("/?q=pomme%20zzzzqq");
  const partial = page.locator(".empty .partial");
  await expect(page.locator(".empty")).toContainText(
    "Aucune recette avec tous les mots.",
  );
  await expect(
    partial.getByRole("link", { name: /« pomme » seul : \d+ recettes?/ }),
  ).toHaveAttribute("href", /q=pomme(&|$)/);
  await expect(partial).toContainText("« zzzzqq » seul : aucune");
});

test("kin words are read every way: « matante » finds a « tante »", async ({
  page,
}) => {
  await page.goto("/?q=matante");
  await expect(page.locator(".cards")).toContainText("Tarte au sucre");
});

test("a wide screen has no row of quick filters (the filters are beside the list) and a worded ↻", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "Parcourir" }),
  ).toBeHidden();
  await expect(
    page
      .locator(".ideas")
      .getByRole("button", { name: "Une autre fiche au hasard" }),
  ).toContainText("Une autre");
});

test("the home page has more ways in: each rail’s head links to exactly its list, and the pantry is a chip away", async ({
  page,
}) => {
  await page.goto("/");
  const ideas = page.locator(".ideas");
  await ideas.getByRole("button", { name: "Plus d’idées" }).click();
  await expect(
    ideas.getByRole("heading", { name: "Pour une tablée · 7 et plus" }),
  ).toBeVisible();
  await expect(
    ideas.locator("a.idea-head", { hasText: "Pour une tablée" }),
  ).toHaveAttribute("href", "/?portions=7%2B");
  await expect(
    ideas.locator("a.idea-head", { hasText: "Les mieux notées" }),
  ).toHaveAttribute("href", "/?sort=rating");
  await expect(
    ideas.locator(".ideas-top").getByRole("link", { name: /Avec ce que j’ai/ }),
  ).toHaveAttribute("href", "/garde-manger");
});

test("the list is lean: no legend of drawings, each drawing named; « à relire » only under the État filter; no greyed letters", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".legend")).toHaveCount(0);
  await expect(page.locator(".card .kind svg title").first()).not.toBeEmpty();
  await expect(page.locator(".card .review:not(.broken)")).toHaveCount(0);
  await expect(page.locator(".letters .off")).toHaveCount(0);
  await page.goto("/?etat=needs-review");
  await expect(page.locator(".card .review").first()).toHaveText("À relire");
});

test("the search box: a short placeholder, the longer hint read out with it", async ({
  page,
}) => {
  await page.goto("/");
  const box = page.locator("#search");
  await expect(box).toHaveAttribute(
    "placeholder",
    "Titre, ingrédient, personne…",
  );
  await expect(box).toHaveAccessibleDescription(
    "Cherchez par titre, ingrédient, personne ou livre.",
  );
});

test("a row is one link: its variant count is words, and a tag the search found sits in its line", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".card .head a:not(.main)")).toHaveCount(0);
  await page.goto("/?q=dessert");
  await expect(page.locator(".card .why")).toHaveCount(0);
  await expect(page.locator(".card .meta .hit").first()).toContainText(
    "Dessert",
  );
  // Filtered by the tag, the rows leave it unsaid.
  await page.goto("/?tag=dessert");
  await expect(page.locator(".card .meta", { hasText: "Dessert" })).toHaveCount(
    0,
  );
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the home page has filters to tap at once, and every idea in its sideways row", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".ideas .more-ideas")).toBeHidden();
    await expect(page.locator(".ideas .idea.extra").first()).toBeVisible();
    const start = page.getByRole("navigation", { name: "Parcourir" });
    await start.getByRole("link", { name: "Dessert" }).click();
    await expect(page).toHaveURL(/tag=dessert/);
  });

  test("the filter sheet closes with its ✕ and with Escape, focus back on « Filtres »", async ({
    page,
  }) => {
    await page.goto("/");
    const open = page.locator(".filters-btn");
    const sheet = page.getByRole("dialog", { name: "Filtres" });
    await open.click();
    await expect(sheet).toBeVisible();
    const x = sheet.getByRole("button", { name: "Fermer les filtres" });
    await expect(x).toBeFocused();
    expect((await x.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await x.click();
    await expect(sheet).toHaveCount(0);
    await expect(open).toBeFocused();
    await open.click();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test("with filters on, « Tout effacer » leads the row of chips", async ({
    page,
  }) => {
    await page.goto("/?tag=dessert");
    const first = page.locator(".row-chips li").first();
    await expect(first).toHaveText("Tout effacer");
    expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("every active filter is in sight, wrapping under the count", async ({
    page,
  }) => {
    await page.goto("/?tag=dessert&tag=four&saison=automne");
    const chips = page.locator(".row-chips li");
    await expect(chips).toHaveCount(4);
    for (const box of await Promise.all(
      (await chips.all()).map((c) => c.boundingBox()),
    ))
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });

  test("a tag tapped in the filter sheet stays under the finger", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".filters-btn").click();
    const tags = page.locator(
      'aside.facets section:has(h3:text-is("Étiquettes"))',
    );
    const more = tags.getByRole("button", { name: /autres/ });
    if (await more.count()) await more.click();
    const link = tags.locator("li a").nth(3);
    const name = (await link.locator(".v").textContent())!;
    const before = (await link.boundingBox())!.y;
    await link.click();
    await expect(page).toHaveURL(/tag=/);
    const after = tags.locator("li a", {
      has: page.locator(".v", { hasText: new RegExp(`^${name}$`) }),
    });
    await expect(after).toHaveAttribute("aria-current", "true");
    expect((await after.boundingBox())!.y).toBe(before);
  });

  test("the letters start under the search box", async ({ page }) => {
    await page.goto("/");
    const rail = page.locator("nav.rail");
    test.skip(!(await rail.isVisible()), "one page: no letters");
    const input = (await page.locator("#search").boundingBox())!;
    expect((await rail.boundingBox())!.y).toBeGreaterThanOrEqual(
      input.y + input.height,
    );
  });

  test("a value that would leave nothing is shown, greyed, not a link", async ({
    page,
  }) => {
    await page.goto("/?tag=dessert");
    await page.locator(".filters-btn").click();
    await expect(page.locator(".facets .none").first()).toBeAttached();
  });
});
