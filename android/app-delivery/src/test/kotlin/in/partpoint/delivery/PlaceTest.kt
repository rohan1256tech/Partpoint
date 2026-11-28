package `in`.partpoint.delivery

import org.junit.Assert.assertEquals
import org.junit.Test

class PlaceTest {
    @Test fun `full address while delivering`() =
        assertEquals("Shop 4, Main Road, Pune 411014", Place(line1 = "Shop 4", line2 = "Main Road", city = "Pune", pincode = "411014").full())

    @Test fun `only the area after delivery, without a stray comma`() =
        assertEquals("Pune 411014", Place(city = "Pune", pincode = "411014").full())
}
