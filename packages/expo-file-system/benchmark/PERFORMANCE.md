# expo-file-system Performance Optimizations for expo-opfs

## Context

The [expo-opfs](https://github.com/pubkey/expo-opfs) library provides an OPFS (Origin Private File System) polyfill for Expo apps. It heavily relies on `expo-file-system`'s `FileHandle` API for synchronous file I/O. This document details the performance optimizations made to `expo-file-system` that directly benefit `expo-opfs` workloads.

## Optimizations Summary

### 1. FileHandle.size Caching (iOS & Android)

**Before:** Every `size` access triggered system calls to determine file size.
- **iOS:** 3 system calls per access (`handle.offset()` → `handle.seekToEnd()` → `handle.seek(toFileOffset:)`)
- **Android:** 1 system call per access (`fileChannel.size()`)

**After:** File size is cached on open and updated incrementally on writes.
- **iOS:** 0 system calls per access (returns cached value)
- **Android:** 0 system calls per access (returns cached value)

**Impact on expo-opfs:** `FileSystemSyncAccessHandle` reads `handle.size` on construction and during `truncate()` operations. While expo-opfs caches size in JavaScript, the initial read and truncate paths still hit native. This optimization eliminates those costs entirely.

| Operation | Before (iOS) | After (iOS) | Savings |
|-----------|-------------|-------------|---------|
| `handle.size` | 3 syscalls | 0 syscalls | **100%** |
| 10,000 size reads | ~30,000 syscalls | 0 syscalls | **30,000 syscalls saved** |

### 2. Android FileHandle.read() — Removed Redundant Syscalls

**Before:** Every `read()` call performed 2 unnecessary system calls before the actual read:
```kotlin
val currentPosition = fileChannel.position()  // syscall 1 (unnecessary)
val totalSize = fileChannel.size()            // syscall 2 (unnecessary)
val available = totalSize - currentPosition
val readAmount = min(length, available)
// ... then actual read
```

**After:** Reads directly from the channel. `FileChannel.read()` naturally handles EOF by returning -1 or fewer bytes, making the pre-checks unnecessary.

**Impact on expo-opfs:** Every `SyncAccessHandle.read()` call translates to a `readBytes()` native call. For a workload reading 1,000 chunks:

| Metric | Before | After | Savings |
|--------|--------|-------|---------|
| Syscalls per read | 3 (position + size + read) | 1 (read only) | **67%** |
| 1,000 chunk reads | 3,000 syscalls | 1,000 syscalls | **2,000 syscalls saved** |

### 3. Combined seek+read/write Operations (`readBytesAt` / `writeBytesAt`)

**Before:** Every positioned read/write in expo-opfs required 2 separate JSI (JavaScript-to-Native) bridge crossings:
```javascript
handle.offset = position;       // JSI call 1: seek
handle.readBytes(length);       // JSI call 2: read
```

**After:** New `readBytesAt(offset, length)` and `writeBytesAt(offset, bytes)` methods combine seek + operation into a single native call:
```javascript
handle.readBytesAt(position, length);  // JSI call 1: seek + read
```

**Impact on expo-opfs:** This is the highest-impact optimization. Every `SyncAccessHandle.read()` and `SyncAccessHandle.write()` with an `at` option uses positioned I/O. Streaming reads (64KB chunks) also benefit.

| Pattern | Before | After | Savings |
|---------|--------|-------|---------|
| Positioned read | 2 JSI calls | 1 JSI call | **50%** |
| Positioned write | 2 JSI calls | 1 JSI call | **50%** |
| Stream 1MB (16 × 64KB) | 32 JSI calls | 16 JSI calls | **50%** |
| Bulk insert (1000 writes) | 2000 JSI calls | 1000 JSI calls | **50%** |

### 4. iOS FileHandle Mode Support

**Before:** iOS always opened files with `FileHandle(forUpdating:)` regardless of the requested mode. This acquires both read and write locks.

**After:** The mode parameter is now respected:
- `"r"` → `FileHandle(forReadingFrom:)` — lighter, read-only lock
- `"w"`, `"wa"`, `"wt"` → `FileHandle(forWritingTo:)` — write-only lock
- Default/`"rw"` → `FileHandle(forUpdating:)` — full read+write access

**Impact on expo-opfs:** `getFile()` opens handles in read-only mode. Using `forReadingFrom` instead of `forUpdating` avoids unnecessary write lock acquisition, which is faster on filesystems that implement separate read/write locks.

## Combined Performance Impact

For a typical expo-opfs workload (e.g., RxDB storage operations):

### Scenario: Read 100 documents (avg 2KB each) from OPFS
```
Operation breakdown per document:
- SyncAccessHandle.read(): offset set + readBytes

Before: 100 × (1 offset_set + 3 read_syscalls) = 400 native operations
After:  100 × (1 readBytesAt) = 100 native operations
Improvement: 75% fewer native operations
```

### Scenario: Write 100 documents (avg 2KB each) to OPFS
```
Before: 100 × (1 offset_set + 1 writeBytes) = 200 JSI crossings
After:  100 × (1 writeBytesAt) = 100 JSI crossings
Improvement: 50% fewer JSI crossings
```

### Scenario: Stream-read a 10MB file in 64KB chunks
```
Chunks: 160

Before: 160 × (1 offset_set + 1 readBytes + 2 extra_syscalls) = 640 operations
After:  160 × (1 readBytesAt) = 160 operations
Improvement: 75% fewer operations
```

## How to Use the New APIs

The new `readBytesAt` and `writeBytesAt` methods are available on `FileHandle`:

```typescript
import { File, Paths } from 'expo-file-system';

const file = new File(Paths.document, 'data.bin');
const handle = file.open();

// Old pattern (2 JSI calls):
handle.offset = 1024;
const data = handle.readBytes(256);

// New pattern (1 JSI call):
const data = handle.readBytesAt(1024, 256);

// Same for writes:
handle.writeBytesAt(1024, new Uint8Array([1, 2, 3]));

handle.close();
```
