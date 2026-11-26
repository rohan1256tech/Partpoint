package `in`.partpoint.app.sell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProductDraftTest {
    private val ok = VariantDraft(name = "Single", mrp = "180", price = "128", stock = "240", minQty = "1", slabs = listOf(SlabDraft("10", "118"), SlabDraft("50", "109")))

    @Test fun `rupee input parsing`() {
        assertEquals(12_800L, parseRupees("128"))
        assertEquals(12_850L, parseRupees("128.5"))
        assertEquals(12_805L, parseRupees("128.05"))
        assertEquals(1_28_000L, parseRupees("₹1,280"))
        assertNull(parseRupees("12.345"))
        assertNull(parseRupees("abc"))
        assertNull(parseRupees(""))
        assertEquals("128.50", paiseToInput(12_850))
        assertEquals("128", paiseToInput(12_800))
    }

    @Test fun `a valid option has no problems and converts to the API body`() {
        assertEquals(emptyList<String>(), ok.problems())
        val input = ok.toInput()
        assertEquals(18_000L, input.mrpPaise)
        assertEquals(listOf(10, 50), input.slabs.map { it.minQty })
    }

    @Test fun `price above MRP is rejected`() =
        assertTrue(ok.copy(price = "200").problems().contains("Selling price cannot be higher than MRP"))

    @Test fun `bulk prices must fall as quantity rises`() =
        assertTrue(ok.copy(slabs = listOf(SlabDraft("10", "118"), SlabDraft("50", "120"))).problems().any { it.startsWith("The price for 50+") })

    @Test fun `bulk quantity must exceed the minimum order`() =
        assertTrue(ok.copy(minQty = "10", slabs = listOf(SlabDraft("10", "118"))).problems().any { it.contains("more than the minimum order (10)") })

    @Test fun `half-filled bulk rows are flagged, empty rows are ignored`() {
        assertTrue(ok.copy(slabs = listOf(SlabDraft("10", ""))).problems().contains("Complete or remove the empty bulk price rows"))
        assertEquals(emptyList<String>(), ok.copy(slabs = listOf(SlabDraft("", ""))).problems())
    }

    @Test fun `product needs a name, category and valid HSN`() {
        val p = ProductDraft(variants = listOf(ok), hsnCode = "123")
        assertEquals(listOf("Enter the product name", "Choose a category", "HSN code must be 4, 6 or 8 digits"), p.problems())
    }

    @Test fun `photos are resized to fit without upscaling`() {
        assertEquals(1600 to 1200, fitWithin(4000, 3000))
        assertEquals(320 to 1600, fitWithin(1000, 5000))
        assertEquals(800 to 600, fitWithin(800, 600))
    }
}

class ProductPatchTest {
    @Test fun `clearing a field sends an explicit null`() {
        val json = ProductPatch("c1", brandId = null, name = "Filter", description = null, partNumber = null, hsnCode = "8421", gstRateBps = 1800).toJson()
        assertTrue(json.containsKey("brandId") && json["brandId"].toString() == "null")
        assertTrue(json.containsKey("description") && json.containsKey("partNumber"))
        assertEquals("\"8421\"", json["hsnCode"].toString())
    }
}
