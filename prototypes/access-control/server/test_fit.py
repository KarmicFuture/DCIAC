import unittest

from server.fit import check_fit, first_fit, free_blocks


RACK = {"uHeight": 42, "depthMm": 1200, "weightLimitKg": 1500}


def model(**extra):
    base = {"model": "Server", "place": "rack", "uHeight": 2, "depthMm": 800, "weightKg": 30}
    base.update(extra)
    return base


class FitTest(unittest.TestCase):
    def test_first_free_block_skips_occupied_u(self):
        spans = [(40, 2), (38, 2), (6, 4)]
        self.assertEqual(first_fit(2, spans, 42), 1)
        self.assertEqual(first_fit(3, [(1, 39)], 42), 40)
        self.assertIsNone(first_fit(3, [(1, 40)], 42))
        self.assertEqual(free_blocks([(1, 2), (5, 1)], 6), [(3, 2), (6, 1)])

    def test_depth_and_weight_reject(self):
        ok, _start, _err = check_fit(model(), [], RACK)
        self.assertTrue(ok)
        ok, _start, err = check_fit(model(depthMm=2000), [], RACK)
        self.assertFalse(ok)
        self.assertIn("depth", err.lower())
        ok, _start, err = check_fit(model(weightKg=40), [{"uPosition": 1, "uHeight": 2, "weightKg": 1480}], RACK)
        self.assertFalse(ok)
        self.assertIn("weight", err.lower())

    def test_contiguous_placement_avoids_taken_units(self):
        taken = [{"uPosition": u, "uHeight": 2, "weightKg": 10} for u in (26, 28, 30, 32, 34, 36, 38, 40)]
        taken.append({"uPosition": 22, "uHeight": 1, "weightKg": 8})
        taken.append({"uPosition": 6, "uHeight": 4, "weightKg": 20})
        ok, start, err = check_fit(model(), taken, RACK)
        self.assertTrue(ok, err)
        self.assertEqual(start, 1)


if __name__ == "__main__":
    unittest.main()
