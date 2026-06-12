import { describe, expect, it } from "vitest";
import { parseLfsPointer } from "./lfsPointer";

const ADDED = `diff --git a/asset.bin b/asset.bin
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/asset.bin
@@ -0,0 +1,3 @@
+version https://git-lfs.github.com/spec/v1
+oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393
+size 12345
`;

const CHANGED = `diff --git a/asset.bin b/asset.bin
index 1111111..2222222 100644
--- a/asset.bin
+++ b/asset.bin
@@ -1,3 +1,3 @@
 version https://git-lfs.github.com/spec/v1
-oid sha256:1111111111111111111111111111111111111111111111111111111111111111
-size 100
+oid sha256:2222222222222222222222222222222222222222222222222222222222222222
+size 200
`;

const PLAIN = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-hello
+world
`;

describe("parseLfsPointer", () => {
  it("parses a newly added pointer", () => {
    const info = parseLfsPointer(ADDED);
    expect(info).not.toBeNull();
    expect(info?.size).toBe(12345);
    expect(info?.oldSize).toBeNull();
    expect(info?.oid).toBe(
      "4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393",
    );
  });

  it("parses a pointer change with old and new size", () => {
    const info = parseLfsPointer(CHANGED);
    expect(info?.size).toBe(200);
    expect(info?.oldSize).toBe(100);
    expect(info?.oid).toBe(
      "2222222222222222222222222222222222222222222222222222222222222222",
    );
  });

  it("returns null for a non-pointer diff", () => {
    expect(parseLfsPointer(PLAIN)).toBeNull();
  });
});
