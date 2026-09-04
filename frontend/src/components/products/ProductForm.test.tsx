/**
 * Test matrix A–M for the multi-colour Free Size / Custom Size fix (see
 * the audit report this test file accompanies). Covers both create and
 * edit flows for ProductForm, specifically:
 *   - free_size/custom size rows now actually appear per colour (the bug)
 *   - standard sizes are unaffected (regression guard)
 *   - existing saved colour variants aren't mutated merely by loading
 *   - a colour with genuinely no sizes still fails validation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ProductForm,
  type ProductFormCategory,
  type ProductFormBody,
  type ProductFormInitial,
} from "./ProductForm";

vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (props: any) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img src={props.src} alt={props.alt} />;
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/uploads", () => ({
  uploadImage: vi.fn(async (file: File) => ({
    image_url: `https://cdn.test/${file.name}`,
    public_id: `pub_${file.name}`,
  })),
  deleteUploadedImage: vi.fn(async () => {}),
}));

vi.mock("@/lib/api/brands", () => ({
  brandsApi: {
    getBySlugOrId: vi.fn(async () => ({ brand: { name: "" } })),
    search: vi.fn(async () => ({ brands: [] })),
  },
}));

const CATS: ProductFormCategory[] = [{ id: "cat1", name: "Dresses", l2: [] }];

const png = () => new File(["x"], "photo.png", { type: "image/png" });

async function fillBasicsAndGoToStep2(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId("prod-name"), "Test Dress");
  await user.selectOptions(screen.getByTestId("prod-l1"), "cat1");
  await user.selectOptions(screen.getByTestId("prod-gender"), "women");
  await user.click(screen.getByRole("button", { name: /Next/i }));
}

async function goToStep3(user: ReturnType<typeof userEvent.setup>, price = "999") {
  await user.type(screen.getByTestId("prod-price"), price);
  await user.click(screen.getByRole("button", { name: /Next/i }));
}

async function addColourWithImage(user: ReturnType<typeof userEvent.setup>, idx: number, name: string) {
  await user.type(screen.getByTestId(`color-name-${idx}`), name);
  await user.upload(screen.getByTestId(`color-add-image-${idx}`), png());
  await waitFor(() => expect(within(screen.getByTestId(`color-variant-${idx}`)).getAllByTestId(/color-image-thumb/)).toHaveLength(1));
}

function renderCreate(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<ProductForm mode="create" cats={CATS} onSubmit={onSubmit} onClose={onClose} />);
  return { onSubmit, onClose };
}

function renderEdit(initialProduct: ProductFormInitial, onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<ProductForm mode="edit" cats={CATS} initialProduct={initialProduct} onSubmit={onSubmit} onClose={onClose} />);
  return { onSubmit, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("A — single colour + standard size", () => {
  it("submits with the toggled standard size and its stock", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();
    await fillBasicsAndGoToStep2(user);
    await user.click(screen.getByTestId("prod-has-colors"));
    await user.selectOptions(screen.getByTestId("prod-size-type"), "alpha");
    await goToStep3(user);
    await addColourWithImage(user, 0, "Purple");
    await user.click(screen.getByTestId("color-size-toggle-0-S"));
    await user.clear(screen.getByTestId("color-stock-0-S"));
    await user.type(screen.getByTestId("color-stock-0-S"), "10");
    await user.click(screen.getByRole("button", { name: /Add product/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const body: ProductFormBody = onSubmit.mock.calls[0]![0];
    expect(body.color_variants).toEqual([
      expect.objectContaining({ name: "Purple", sizes: [{ size: "S", stock: 10 }] }),
    ]);
  });
});

describe("B — single colour + Free Size + stock", () => {
  it("auto-offers Free Size for the colour with no manual toggling needed", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();
    await fillBasicsAndGoToStep2(user);
    await user.click(screen.getByTestId("prod-has-colors"));
    await user.selectOptions(screen.getByTestId("prod-size-type"), "free_size");
    await goToStep3(user);
    await addColourWithImage(user, 0, "Purple");

    // Free Size stock input must already be present — no toggle click needed.
    const stockInput = await screen.findByTestId("color-stock-0-Free Size");
    await user.clear(stockInput);
    await user.type(stockInput, "10");
    await user.click(screen.getByRole("button", { name: /Add product/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const body: ProductFormBody = onSubmit.mock.calls[0]![0];
    expect(body.color_variants).toEqual([
      expect.objectContaining({ name: "Purple", sizes: [{ size: "Free Size", stock: 10 }] }),
    ]);
  });
});

describe("C — single colour + Custom Size + stock", () => {
  it("makes the typed custom size available in the colour's Sizes and stock section", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();
    await fillBasicsAndGoToStep2(user);
    await user.click(screen.getByTestId("prod-has-colors"));
    await user.selectOptions(screen.getByTestId("prod-size-type"), "custom");
    await user.type(screen.getByTestId("prod-custom-sizes"), "28 Waist");
    await goToStep3(user);
    await addColourWithImage(user, 0, "Purple");

    const stockInput = await screen.findByTestId("color-stock-0-28 Waist");
    await user.clear(stockInput);
    await user.type(stockInput, "10");
    await user.click(screen.getByRole("button", { name: /Add product/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const body: ProductFormBody = onSubmit.mock.calls[0]![0];
    expect(body.color_variants).toEqual([
      expect.objectContaining({ name: "Purple", sizes: [{ size: "28 Waist", stock: 10 }] }),
    ]);
  });
});

describe("D — two colours + Free Size with independent stock", () => {
  it("Purple=5, Black=8, each independent", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();
    await fillBasicsAndGoToStep2(user);
    await user.click(screen.getByTestId("prod-has-colors"));
    await user.selectOptions(screen.getByTestId("prod-size-type"), "free_size");
    await goToStep3(user);

    await addColourWithImage(user, 0, "Purple");
    const purpleStock = await screen.findByTestId("color-stock-0-Free Size");
    await user.clear(purpleStock);
    await user.type(purpleStock, "5");

    await user.click(screen.getByTestId("add-color-variant"));
    await addColourWithImage(user, 1, "Black");
    // New colour must already have a Free Size row too — no manual toggle.
    const blackStock = await screen.findByTestId("color-stock-1-Free Size");
    await user.clear(blackStock);
    await user.type(blackStock, "8");

    await user.click(screen.getByRole("button", { name: /Add product/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const body: ProductFormBody = onSubmit.mock.calls[0]![0];
    expect(body.color_variants).toEqual([
      expect.objectContaining({ name: "Purple", sizes: [{ size: "Free Size", stock: 5 }] }),
      expect.objectContaining({ name: "Black", sizes: [{ size: "Free Size", stock: 8 }] }),
    ]);
  });
});

describe("E — two colours + Custom Size sharing the same size, independent stock", () => {
  it("Purple=5, Black=8, both '30x32'", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();
    await fillBasicsAndGoToStep2(user);
    await user.click(screen.getByTestId("prod-has-colors"));
    await user.selectOptions(screen.getByTestId("prod-size-type"), "custom");
    await user.type(screen.getByTestId("prod-custom-sizes"), "30x32");
    await goToStep3(user);

    await addColourWithImage(user, 0, "Purple");
    const purpleStock = await screen.findByTestId("color-stock-0-30x32");
    await user.clear(purpleStock);
    await user.type(purpleStock, "5");

    await user.click(screen.getByTestId("add-color-variant"));
    await addColourWithImage(user, 1, "Black");
    const blackStock = await screen.findByTestId("color-stock-1-30x32");
    await user.clear(blackStock);
    await user.type(blackStock, "8");

    await user.click(screen.getByRole("button", { name: /Add product/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const body: ProductFormBody = onSubmit.mock.calls[0]![0];
    expect(body.color_variants).toEqual([
      expect.objectContaining({ name: "Purple", sizes: [{ size: "30x32", stock: 5 }] }),
      expect.objectContaining({ name: "Black", sizes: [{ size: "30x32", stock: 8 }] }),
    ]);
  });
});

describe("F — two colours + standard sizes with independent stock/sizes", () => {
  it("Purple=S(5), Black=M(7) — colours can still carry different sizes", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();
    await fillBasicsAndGoToStep2(user);
    await user.click(screen.getByTestId("prod-has-colors"));
    await user.selectOptions(screen.getByTestId("prod-size-type"), "alpha");
    await goToStep3(user);

    await addColourWithImage(user, 0, "Purple");
    await user.click(screen.getByTestId("color-size-toggle-0-S"));
    const purpleStock = screen.getByTestId("color-stock-0-S");
    await user.clear(purpleStock);
    await user.type(purpleStock, "5");

    await user.click(screen.getByTestId("add-color-variant"));
    await addColourWithImage(user, 1, "Black");
    await user.click(screen.getByTestId("color-size-toggle-1-M"));
    const blackStock = screen.getByTestId("color-stock-1-M");
    await user.clear(blackStock);
    await user.type(blackStock, "7");

    await user.click(screen.getByRole("button", { name: /Add product/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const body: ProductFormBody = onSubmit.mock.calls[0]![0];
    expect(body.color_variants).toEqual([
      expect.objectContaining({ name: "Purple", sizes: [{ size: "S", stock: 5 }] }),
      expect.objectContaining({ name: "Black", sizes: [{ size: "M", stock: 7 }] }),
    ]);
  });
});

describe("G — mixed colours, different stock for the same size", () => {
  it("Purple=3, Black=6 for the same numeric size", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();
    await fillBasicsAndGoToStep2(user);
    await user.click(screen.getByTestId("prod-has-colors"));
    await user.selectOptions(screen.getByTestId("prod-size-type"), "numeric_shirt");
    await goToStep3(user);

    await addColourWithImage(user, 0, "Purple");
    await user.click(screen.getByTestId("color-size-toggle-0-40"));
    const purpleStock = screen.getByTestId("color-stock-0-40");
    await user.clear(purpleStock);
    await user.type(purpleStock, "3");

    await user.click(screen.getByTestId("add-color-variant"));
    await addColourWithImage(user, 1, "Black");
    await user.click(screen.getByTestId("color-size-toggle-1-40"));
    const blackStock = screen.getByTestId("color-stock-1-40");
    await user.clear(blackStock);
    await user.type(blackStock, "6");

    await user.click(screen.getByRole("button", { name: /Add product/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const body: ProductFormBody = onSubmit.mock.calls[0]![0];
    expect(body.stock).toEqual({ "40": 9 }); // server-side derivation sums across colours; local mirror does too
    expect(body.color_variants).toEqual([
      expect.objectContaining({ name: "Purple", sizes: [{ size: "40", stock: 3 }] }),
      expect.objectContaining({ name: "Black", sizes: [{ size: "40", stock: 6 }] }),
    ]);
  });
});

describe("H — validation genuinely rejects a colour with no sizes", () => {
  it("blocks submit and never calls onSubmit when a named colour has zero sizes", async () => {
    const { toast } = await import("sonner");
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();
    await fillBasicsAndGoToStep2(user);
    await user.click(screen.getByTestId("prod-has-colors"));
    // Deliberately never select a size_type.
    await goToStep3(user);
    await addColourWithImage(user, 0, "Red");

    await user.click(screen.getByRole("button", { name: /Add product/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('"Red" needs at least one size'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("I — legacy/non-colour product creation still works", () => {
  it("submits a plain flat product with no color_variants key", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();
    await fillBasicsAndGoToStep2(user);
    // hasColors left unchecked.
    await user.selectOptions(screen.getByTestId("prod-size-type"), "alpha");
    await user.click(screen.getByTestId("size-toggle-M"));
    await user.type(screen.getByTestId("prod-stock-M"), "20");
    await goToStep3(user);
    await user.upload(screen.getByTestId("prod-add-image"), png());
    await waitFor(() => expect(screen.getAllByTestId(/prod-image-thumb/)).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: /Add product/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const body: ProductFormBody = onSubmit.mock.calls[0]![0];
    expect(body.color_variants).toBeUndefined();
    expect(body.sizes).toEqual(["M"]);
    expect(body.stock).toEqual({ M: 20 });
  });
});

describe("J — editing an existing colour-variant product", () => {
  const existing: ProductFormInitial = {
    id: "p1",
    name: "Existing Dress",
    price: 500,
    l1_id: "cat1",
    gender: "women",
    size_type: "alpha",
    sizes: ["S"],
    stock: { S: 5 },
    color_variants: [
      { id: "cv1", name: "Purple", hex: "#800080", images: [{ url: "https://cdn.test/1.png", public_id: "p1" }], sizes: [{ size: "S", stock: 5 }] },
    ],
  };

  it("loading the form does not add or change existing sizes/stock", async () => {
    renderEdit(existing);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Next/i })); // -> step 2
    await user.click(screen.getByRole("button", { name: /Next/i })); // -> step 3

    const variant = screen.getByTestId("color-variant-0");
    // Exactly one size row (S) — backfill must not have added the other 5
    // alpha sizes into an already-populated variant.
    expect(within(variant).getAllByTestId(/^color-stock-0-/)).toHaveLength(1);
    expect(within(variant).getByTestId("color-stock-0-S")).toHaveValue(5);
  });

  it("editing stock on the existing size persists correctly, size is preserved", async () => {
    const { onSubmit } = renderEdit(existing);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Next/i }));
    await user.click(screen.getByRole("button", { name: /Next/i }));

    const stockInput = screen.getByTestId("color-stock-0-S");
    await user.clear(stockInput);
    await user.type(stockInput, "9");
    await user.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const body: ProductFormBody = onSubmit.mock.calls[0]![0];
    expect(body.color_variants).toEqual([
      expect.objectContaining({ name: "Purple", sizes: [{ size: "S", stock: 9 }] }),
    ]);
  });

  it("adding a new colour while editing offers the product's current size configuration (standard sizes: catalog buttons, unaffected by the fix)", async () => {
    renderEdit(existing);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Next/i }));
    await user.click(screen.getByRole("button", { name: /Next/i }));

    await user.click(screen.getByTestId("add-color-variant"));
    const newVariant = screen.getByTestId("color-variant-1");
    // Standard sizes are NOT auto-toggled-on (that would flip "click to
    // add" into "click to remove" — see resolveGlobalSizeRows). The full
    // alpha catalog is still immediately available to toggle, same as the
    // pre-existing (unaffected) standard-size behavior.
    for (const sz of ["XS", "S", "M", "L", "XL", "XXL"]) {
      expect(within(newVariant).getByTestId(`color-size-toggle-1-${sz}`)).toBeInTheDocument();
    }
    expect(within(newVariant).queryByTestId(/^color-stock-1-/)).not.toBeInTheDocument();
  });

  it("adding a new colour to a Free Size product while editing auto-receives Free Size (the fix)", async () => {
    const freeSizeExisting: ProductFormInitial = {
      ...existing,
      size_type: "free_size",
      sizes: ["Free Size"],
      stock: { "Free Size": 5 },
      color_variants: [
        { id: "cv1", name: "Purple", hex: "#800080", images: [{ url: "https://cdn.test/1.png", public_id: "p1" }], sizes: [{ size: "Free Size", stock: 5 }] },
      ],
    };
    renderEdit(freeSizeExisting);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Next/i }));
    await user.click(screen.getByRole("button", { name: /Next/i }));

    await user.click(screen.getByTestId("add-color-variant"));
    const newVariant = screen.getByTestId("color-variant-1");
    expect(within(newVariant).getByTestId("color-stock-1-Free Size")).toHaveValue(0);
  });
});

describe("K — Free Size colour variant persists and reloads correctly", () => {
  it("round-trips through create then edit hydration with the correct stock", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();
    await fillBasicsAndGoToStep2(user);
    await user.click(screen.getByTestId("prod-has-colors"));
    await user.selectOptions(screen.getByTestId("prod-size-type"), "free_size");
    await goToStep3(user);
    await addColourWithImage(user, 0, "Purple");
    const stockInput = await screen.findByTestId("color-stock-0-Free Size");
    await user.clear(stockInput);
    await user.type(stockInput, "10");
    await user.click(screen.getByRole("button", { name: /Add product/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const created: ProductFormBody = onSubmit.mock.calls[0]![0];
    cleanup();

    const reloaded: ProductFormInitial = {
      id: "p2", name: created.name, price: created.price, l1_id: created.l1_id, gender: created.gender,
      size_type: created.size_type, sizes: created.sizes, stock: created.stock,
      color_variants: created.color_variants,
    };
    renderEdit(reloaded);
    const user2 = userEvent.setup();
    await user2.click(screen.getByRole("button", { name: /Next/i }));
    await user2.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByTestId("color-stock-0-Free Size")).toHaveValue(10);
  });
});

describe("L — Custom Size colour variant persists and reloads correctly", () => {
  it("round-trips the exact custom size string, unmodified", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();
    await fillBasicsAndGoToStep2(user);
    await user.click(screen.getByTestId("prod-has-colors"));
    await user.selectOptions(screen.getByTestId("prod-size-type"), "custom");
    await user.type(screen.getByTestId("prod-custom-sizes"), "28 Waist");
    await goToStep3(user);
    await addColourWithImage(user, 0, "Purple");
    const stockInput = await screen.findByTestId("color-stock-0-28 Waist");
    await user.clear(stockInput);
    await user.type(stockInput, "6");
    await user.click(screen.getByRole("button", { name: /Add product/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const created: ProductFormBody = onSubmit.mock.calls[0]![0];
    expect(created.color_variants?.[0]?.sizes[0]?.size).toBe("28 Waist");
    cleanup();

    const reloaded: ProductFormInitial = {
      id: "p3", name: created.name, price: created.price, l1_id: created.l1_id, gender: created.gender,
      size_type: created.size_type, sizes: created.sizes, stock: created.stock,
      color_variants: created.color_variants,
    };
    renderEdit(reloaded);
    const user2 = userEvent.setup();
    await user2.click(screen.getByRole("button", { name: /Next/i })); // -> step 2
    // The exact string reappears as-is on Step 2, not coerced to a standard size.
    expect(screen.getByTestId("prod-custom-sizes")).toHaveValue("28 Waist");
    await user2.click(screen.getByRole("button", { name: /Next/i })); // -> step 3
    expect(screen.getByTestId("color-stock-0-28 Waist")).toHaveValue(6);
  });
});
