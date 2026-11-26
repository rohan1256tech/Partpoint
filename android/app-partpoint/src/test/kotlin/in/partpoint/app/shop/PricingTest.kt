package `in`.partpoint.app.shop

import org.junit.Assert.assertEquals
import org.junit.Test

class PricingTest {
    private val filter = Variant(
        id = "v1", name = "Single", mrpPaise = 18_000, pricePaise = 12_800, stockQty = 240,
        slabs = listOf(Slab(minQty = 10, pricePaise = 11_800), Slab(minQty = 50, pricePaise = 10_900)),
    )

    @Test fun `base price below the first slab`() = assertEquals(12_800L, filter.unitPriceAt(9))

    @Test fun `slab price applies from its minimum quantity`() {
        assertEquals(11_800L, filter.unitPriceAt(10))
        assertEquals(11_800L, filter.unitPriceAt(49))
        assertEquals(10_900L, filter.unitPriceAt(50))
        assertEquals(10_900L, filter.unitPriceAt(500))
    }

    @Test fun `no slabs means the base price at any quantity`() =
        assertEquals(9_200L, filter.copy(pricePaise = 9_200, slabs = emptyList()).unitPriceAt(1_000))
}
