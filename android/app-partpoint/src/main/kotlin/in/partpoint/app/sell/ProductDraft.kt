package `in`.partpoint.app.sell

import `in`.partpoint.app.shop.ProductDetail
import `in`.partpoint.app.shop.Slab

/** GST rates the API accepts, in basis points (GST 2.0 slabs are 0, 5, 18 and 40%; 12 and 28% remain for older items). */
val GST_RATES = listOf(0, 500, 1200, 1800, 2800, 4000)

/** "128.5" / "₹1,280" → paise; null when it is not a valid amount. */
fun parseRupees(text: String): Long? {
    val clean = text.replace("₹", "").replace(",", "").trim()
    if (clean.isEmpty() || !Regex("^\\d{1,9}(\\.\\d{1,2})?$").matches(clean)) return null
    val parts = clean.split('.')
    val rupees = parts[0].toLong()
    val paise = parts.getOrNull(1)?.padEnd(2, '0')?.toLong() ?: 0
    return rupees * 100 + paise
}

/** Paise → "128.50" or "128" for editing. */
fun paiseToInput(paise: Long): String = if (paise % 100 == 0L) "${paise / 100}" else "%d.%02d".format(paise / 100, paise % 100)

data class SlabDraft(val minQty: String = "", val price: String = "")

data class VariantDraft(
    val id: String? = null,
    val name: String = "",
    val mrp: String = "",
    val price: String = "",
    val stock: String = "",
    val minQty: String = "1",
    val isActive: Boolean = true,
    val slabs: List<SlabDraft> = emptyList(),
) {
    fun slabValues(): List<Slab>? = slabs.filter { it.minQty.isNotBlank() || it.price.isNotBlank() }.map {
        Slab(it.minQty.toIntOrNull() ?: return null, parseRupees(it.price) ?: return null)
    }

    /** The same checks as the server (backend pricing.ts), in words a seller understands. */
    fun problems(): List<String> {
        val out = mutableListOf<String>()
        if (name.isBlank()) out += "Give this option a name, e.g. Single or Box of 10"
        val mrpP = parseRupees(mrp)
        val priceP = parseRupees(price)
        if (mrpP == null || mrpP <= 0) out += "Enter the MRP"
        if (priceP == null || priceP <= 0) out += "Enter your selling price"
        if (mrpP != null && priceP != null && priceP > mrpP) out += "Selling price cannot be higher than MRP"
        if (stock.toIntOrNull()?.takeIf { it >= 0 } == null) out += "Enter the stock (0 if none)"
        val min = minQty.toIntOrNull()?.takeIf { it >= 1 }
        if (min == null) out += "Minimum order must be at least 1"
        val slabList = slabValues()
        if (slabList == null) {
            out += "Complete or remove the empty bulk price rows"
        } else if (min != null && priceP != null) {
            if (slabList.size > 5) out += "At most 5 bulk prices"
            var prevQty: Int = min
            var prevPrice: Long = priceP
            for (s in slabList.sortedBy { it.minQty }) {
                when {
                    s.minQty <= prevQty && s.minQty <= min -> out += "Bulk quantity ${s.minQty} must be more than the minimum order ($min)"
                    s.minQty <= prevQty -> out += "Bulk quantity ${s.minQty} is listed twice"
                    s.pricePaise >= prevPrice -> out += "The price for ${s.minQty}+ must be lower than the price before it"
                }
                prevQty = maxOf(prevQty, s.minQty)
                prevPrice = minOf(prevPrice, s.pricePaise)
            }
        }
        return out
    }

    fun toInput() = VariantInput(
        name = name.trim(),
        mrpPaise = parseRupees(mrp) ?: 0,
        pricePaise = parseRupees(price) ?: 0,
        stockQty = stock.toIntOrNull() ?: 0,
        minOrderQty = minQty.toIntOrNull() ?: 1,
        slabs = slabValues().orEmpty().sortedBy { it.minQty },
    )

    fun toPatch() = toInput().let { VariantPatch(it.name, null, it.mrpPaise, it.pricePaise, it.stockQty, it.minOrderQty, isActive, it.slabs) }
}

data class ProductDraft(
    val id: String? = null,
    val status: String = "draft",
    val statusReason: String? = null,
    val name: String = "",
    val categoryId: String? = null,
    val brandId: String? = null,
    val partNumber: String = "",
    val hsnCode: String = "",
    val gstRateBps: Int = 1800,
    val description: String = "",
    val variants: List<VariantDraft> = listOf(VariantDraft(name = "Single")),
    val images: List<Pair<String, String>> = emptyList(), // id to url
) {
    fun problems(): List<String> {
        val out = mutableListOf<String>()
        if (name.isBlank()) out += "Enter the product name"
        if (categoryId == null) out += "Choose a category"
        if (hsnCode.isNotBlank() && !Regex("^(\\d{4}|\\d{6}|\\d{8})$").matches(hsnCode)) out += "HSN code must be 4, 6 or 8 digits"
        if (variants.none { it.isActive }) out += "Keep at least one option on sale"
        variants.forEachIndexed { i, v -> v.problems().forEach { p -> out += if (variants.size > 1) "Option ${i + 1}: $p" else p } }
        return out
    }

    fun toCreate() = ProductCreate(
        categoryId = categoryId!!,
        brandId = brandId,
        name = name.trim(),
        description = description.trim().ifEmpty { null },
        partNumber = partNumber.trim().ifEmpty { null },
        hsnCode = hsnCode.trim().ifEmpty { null },
        gstRateBps = gstRateBps,
        variants = variants.map { it.toInput() },
    )

    fun toPatch() = ProductPatch(
        categoryId = categoryId!!,
        brandId = brandId,
        name = name.trim(),
        description = description.trim().ifEmpty { null },
        partNumber = partNumber.trim().ifEmpty { null },
        hsnCode = hsnCode.trim().ifEmpty { null },
        gstRateBps = gstRateBps,
    )

    companion object {
        fun from(p: ProductDetail) = ProductDraft(
            id = p.id,
            status = p.status,
            statusReason = p.statusReason,
            name = p.name,
            categoryId = p.category.id,
            brandId = p.brand?.id,
            partNumber = p.partNumber.orEmpty(),
            hsnCode = p.hsnCode.orEmpty(),
            gstRateBps = p.gstRateBps,
            description = p.description.orEmpty(),
            variants = p.variants.map { v ->
                VariantDraft(
                    id = v.id,
                    name = v.name,
                    mrp = paiseToInput(v.mrpPaise),
                    price = paiseToInput(v.pricePaise),
                    stock = v.stockQty.toString(),
                    minQty = v.minOrderQty.toString(),
                    isActive = v.isActive,
                    slabs = v.slabs.map { SlabDraft(it.minQty.toString(), paiseToInput(it.pricePaise)) },
                )
            },
            images = p.images.sortedBy { it.sortOrder }.map { it.id to it.url },
        )
    }
}
