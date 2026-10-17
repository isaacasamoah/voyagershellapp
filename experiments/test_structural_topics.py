import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCANNER = Path(sys.argv.pop(1)).resolve()


class ScannerTest(unittest.TestCase):
    def test_incremental_scan_and_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            (root / 'src').mkdir()
            (root / 'desktop/src').mkdir(parents=True)
            (root / 'Cargo.toml').write_text('[package]\nname="sample"\nversion="0.1.0"\n')
            (root / 'desktop/package.json').write_text('{"name":"sample-ui","main":"src/main.cjs"}')
            source = root / 'src/lib.rs'
            source.write_text('pub fn send(id: u64) -> bool { true }')
            subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(root), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], check=True)
            def scan(previous=None):
                result = subprocess.run([str(SCANNER), str(root), *([str(previous)] if previous else [])], check=True, capture_output=True, text=True)
                return json.loads(result.stdout)
            initial = scan()
            cache = root / 'catalogue.json'
            cache.write_text(json.dumps(initial))
            unchanged = scan(cache)
            self.assertEqual(unchanged['refresh']['reused'], 1)
            self.assertEqual(unchanged['refresh']['parsed'], 0)
            source.write_text('pub fn send(id: u64) -> bool { false }')
            body = scan(cache)
            self.assertEqual(body['refresh']['parsed'], 1)
            self.assertEqual(body['refresh']['structure_changed'], [])
            source.write_text('pub fn send(id: &str) -> bool { false }')
            interface = scan(cache)
            self.assertEqual(interface['refresh']['structure_changed'], ['src/lib.rs'])
            new_module = root / 'src/new.rs'
            new_module.write_text('pub fn created() {}')
            added = scan(cache)
            self.assertIn('src/new.rs', added['refresh']['structure_changed'])
            cache.write_text(json.dumps(added))
            new_module.unlink()
            removed = scan(cache)
            self.assertEqual(removed['refresh']['removed'], ['src/new.rs'])
            (root / 'Cargo.toml').write_text('[package]\nname="sample"\nversion="0.1.0"\n[dependencies]\nserde="1"\n')
            self.assertTrue(scan(cache)['refresh']['packages_changed'])
            source.write_text('pub fn broken( {')
            invalid = subprocess.run([str(SCANNER), str(root), str(cache)], capture_output=True, text=True)
            self.assertNotEqual(invalid.returncode, 0)
            self.assertEqual(invalid.stdout, '')
            self.assertEqual(json.loads(cache.read_text()), added)


if __name__ == '__main__':
    unittest.main()
