/**
 * Benchmark script for expo-file-system FileHandle performance optimizations.
 *
 * This script simulates the exact I/O patterns used by expo-opfs
 * (https://github.com/pubkey/expo-opfs) to demonstrate the performance
 * difference between old-style (separate offset + read/write) and
 * new-style (combined readBytesAt / writeBytesAt) operations.
 *
 * Usage: Import and call `runBenchmark()` from an Expo app component.
 *
 * Example:
 *   import { runBenchmark } from 'expo-file-system/benchmark/run-benchmark';
 *   const results = await runBenchmark();
 *   console.log(results.summary);
 */

import { File, Directory, Paths } from 'expo-file-system';

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  opsPerSec: number;
}

interface BenchmarkSuite {
  results: BenchmarkResult[];
  comparisons: { name: string; oldMs: number; newMs: number; speedup: string }[];
  summary: string;
}

function generateRandomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function formatMs(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;
}

/**
 * Benchmark: Positioned reads using old pattern (offset set + readBytes)
 */
function benchPositionedReadsOld(
  file: InstanceType<typeof File>,
  fileSize: number,
  chunkSize: number,
  iterations: number
): BenchmarkResult {
  const handle = file.open();
  const positions = Array.from({ length: iterations }, () =>
    Math.floor(Math.random() * Math.max(1, fileSize - chunkSize))
  );

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    handle.offset = positions[i]; // JSI call 1
    handle.readBytes(chunkSize); // JSI call 2
  }
  const totalMs = performance.now() - start;
  handle.close();

  return {
    name: 'Positioned reads (old: offset + readBytes)',
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    opsPerSec: (iterations / totalMs) * 1000,
  };
}

/**
 * Benchmark: Positioned reads using new pattern (readBytesAt)
 */
function benchPositionedReadsNew(
  file: InstanceType<typeof File>,
  fileSize: number,
  chunkSize: number,
  iterations: number
): BenchmarkResult {
  const handle = file.open();
  const positions = Array.from({ length: iterations }, () =>
    Math.floor(Math.random() * Math.max(1, fileSize - chunkSize))
  );

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    handle.readBytesAt(positions[i], chunkSize); // JSI call 1 (combined)
  }
  const totalMs = performance.now() - start;
  handle.close();

  return {
    name: 'Positioned reads (new: readBytesAt)',
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    opsPerSec: (iterations / totalMs) * 1000,
  };
}

/**
 * Benchmark: Positioned writes using old pattern (offset set + writeBytes)
 */
function benchPositionedWritesOld(
  file: InstanceType<typeof File>,
  chunkSize: number,
  iterations: number
): BenchmarkResult {
  const handle = file.open();
  const data = generateRandomBytes(chunkSize);
  const positions = Array.from({ length: iterations }, (_, i) => i * chunkSize);

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    handle.offset = positions[i]; // JSI call 1
    handle.writeBytes(data); // JSI call 2
  }
  const totalMs = performance.now() - start;
  handle.close();

  return {
    name: 'Positioned writes (old: offset + writeBytes)',
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    opsPerSec: (iterations / totalMs) * 1000,
  };
}

/**
 * Benchmark: Positioned writes using new pattern (writeBytesAt)
 */
function benchPositionedWritesNew(
  file: InstanceType<typeof File>,
  chunkSize: number,
  iterations: number
): BenchmarkResult {
  const handle = file.open();
  const data = generateRandomBytes(chunkSize);
  const positions = Array.from({ length: iterations }, (_, i) => i * chunkSize);

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    handle.writeBytesAt(positions[i], data); // JSI call 1 (combined)
  }
  const totalMs = performance.now() - start;
  handle.close();

  return {
    name: 'Positioned writes (new: writeBytesAt)',
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    opsPerSec: (iterations / totalMs) * 1000,
  };
}

/**
 * Benchmark: Size reads (tests cached vs uncached size)
 */
function benchSizeReads(
  file: InstanceType<typeof File>,
  iterations: number
): BenchmarkResult {
  const handle = file.open();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const _size = handle.size; // With caching: 0 syscalls. Without: 3 syscalls (iOS) or 1 (Android)
  }
  const totalMs = performance.now() - start;
  handle.close();

  return {
    name: 'Size reads (cached)',
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    opsPerSec: (iterations / totalMs) * 1000,
  };
}

/**
 * Benchmark: Simulated OPFS SyncAccessHandle read pattern
 * This matches exactly what expo-opfs does in SyncAccessHandle.read()
 */
function benchOpfsReadPatternOld(
  file: InstanceType<typeof File>,
  fileSize: number,
  iterations: number
): BenchmarkResult {
  const handle = file.open();
  const bufferSize = 4096; // typical document size
  let cursor = 0;

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const at = (i * bufferSize) % Math.max(1, fileSize - bufferSize);

    // This is what expo-opfs SyncAccessHandle.read() does:
    handle.offset = at; // JSI call 1
    cursor = at;

    const currentSize = handle.size ?? 0; // JSI call 2 (was 3 syscalls on iOS!)
    const currentOffset = cursor;
    if (currentOffset >= currentSize) continue;
    const available = Math.max(0, currentSize - currentOffset);
    const actualBytesToRead = Math.min(bufferSize, available);

    const readData = handle.readBytes(actualBytesToRead); // JSI call 3
    cursor += readData.length;
  }
  const totalMs = performance.now() - start;
  handle.close();

  return {
    name: 'OPFS read pattern (old: 3 JSI calls)',
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    opsPerSec: (iterations / totalMs) * 1000,
  };
}

/**
 * Benchmark: Optimized OPFS SyncAccessHandle read pattern
 * Uses readBytesAt and cached size
 */
function benchOpfsReadPatternNew(
  file: InstanceType<typeof File>,
  fileSize: number,
  iterations: number
): BenchmarkResult {
  const handle = file.open();
  const bufferSize = 4096;
  let cachedSize = handle.size ?? 0; // read once (cached, 0 syscalls)

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const at = (i * bufferSize) % Math.max(1, fileSize - bufferSize);

    if (at >= cachedSize) continue;
    const available = Math.max(0, cachedSize - at);
    const actualBytesToRead = Math.min(bufferSize, available);

    const readData = handle.readBytesAt(at, actualBytesToRead); // JSI call 1 (combined)
  }
  const totalMs = performance.now() - start;
  handle.close();

  return {
    name: 'OPFS read pattern (new: 1 JSI call)',
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    opsPerSec: (iterations / totalMs) * 1000,
  };
}

/**
 * Benchmark: Stream read pattern (simulates expo-opfs getFile().stream())
 */
function benchStreamReadOld(
  file: InstanceType<typeof File>,
  fileSize: number
): BenchmarkResult {
  const CHUNK_SIZE = 64 * 1024; // 64KB chunks, same as expo-opfs
  const handle = file.open();
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  let offset = 0;

  const start = performance.now();
  for (let i = 0; i < totalChunks; i++) {
    const chunkLength = Math.min(CHUNK_SIZE, fileSize - offset);
    handle.offset = offset; // JSI call 1
    handle.readBytes(chunkLength); // JSI call 2
    offset += chunkLength;
  }
  const totalMs = performance.now() - start;
  handle.close();

  return {
    name: `Stream read ${(fileSize / 1024).toFixed(0)}KB (old: offset + readBytes)`,
    iterations: totalChunks,
    totalMs,
    avgMs: totalMs / totalChunks,
    opsPerSec: (totalChunks / totalMs) * 1000,
  };
}

function benchStreamReadNew(
  file: InstanceType<typeof File>,
  fileSize: number
): BenchmarkResult {
  const CHUNK_SIZE = 64 * 1024;
  const handle = file.open();
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  let offset = 0;

  const start = performance.now();
  for (let i = 0; i < totalChunks; i++) {
    const chunkLength = Math.min(CHUNK_SIZE, fileSize - offset);
    handle.readBytesAt(offset, chunkLength); // JSI call 1 (combined)
    offset += chunkLength;
  }
  const totalMs = performance.now() - start;
  handle.close();

  return {
    name: `Stream read ${(fileSize / 1024).toFixed(0)}KB (new: readBytesAt)`,
    iterations: totalChunks,
    totalMs,
    avgMs: totalMs / totalChunks,
    opsPerSec: (totalChunks / totalMs) * 1000,
  };
}

/**
 * Run all benchmarks and return results with comparisons.
 */
export async function runBenchmark(): Promise<BenchmarkSuite> {
  const benchDir = new Directory(Paths.document, '.expo-fs-benchmark');
  if (!benchDir.exists) {
    benchDir.create();
  }

  // Create test files
  const smallFile = new File(benchDir, 'small.bin');
  const mediumFile = new File(benchDir, 'medium.bin');
  const largeFile = new File(benchDir, 'large.bin');

  const SMALL_SIZE = 64 * 1024; // 64KB
  const MEDIUM_SIZE = 1024 * 1024; // 1MB
  const LARGE_SIZE = 10 * 1024 * 1024; // 10MB

  // Setup: write test data
  for (const [file, size] of [
    [smallFile, SMALL_SIZE],
    [mediumFile, MEDIUM_SIZE],
    [largeFile, LARGE_SIZE],
  ] as const) {
    if (file.exists) file.delete();
    file.create();
    const handle = file.open();
    const chunkSize = 64 * 1024;
    let written = 0;
    while (written < size) {
      const chunk = generateRandomBytes(Math.min(chunkSize, size - written));
      handle.writeBytes(chunk);
      written += chunk.length;
    }
    handle.close();
  }

  const results: BenchmarkResult[] = [];
  const comparisons: { name: string; oldMs: number; newMs: number; speedup: string }[] = [];
  const ITERATIONS = 1000;

  // --- Benchmark 1: Positioned reads (small file, 4KB chunks) ---
  const readOld = benchPositionedReadsOld(smallFile, SMALL_SIZE, 4096, ITERATIONS);
  const readNew = benchPositionedReadsNew(smallFile, SMALL_SIZE, 4096, ITERATIONS);
  results.push(readOld, readNew);
  comparisons.push({
    name: 'Positioned reads (4KB chunks, 1000 iterations)',
    oldMs: readOld.totalMs,
    newMs: readNew.totalMs,
    speedup: `${((readOld.totalMs / readNew.totalMs - 1) * 100).toFixed(1)}% faster`,
  });

  // --- Benchmark 2: Positioned writes (4KB chunks) ---
  const writeFileOld = new File(benchDir, 'write-old.bin');
  const writeFileNew = new File(benchDir, 'write-new.bin');
  if (writeFileOld.exists) writeFileOld.delete();
  if (writeFileNew.exists) writeFileNew.delete();
  writeFileOld.create();
  writeFileNew.create();

  const writeOld = benchPositionedWritesOld(writeFileOld, 4096, ITERATIONS);
  const writeNew = benchPositionedWritesNew(writeFileNew, 4096, ITERATIONS);
  results.push(writeOld, writeNew);
  comparisons.push({
    name: 'Positioned writes (4KB chunks, 1000 iterations)',
    oldMs: writeOld.totalMs,
    newMs: writeNew.totalMs,
    speedup: `${((writeOld.totalMs / writeNew.totalMs - 1) * 100).toFixed(1)}% faster`,
  });

  // --- Benchmark 3: Size reads ---
  const sizeResult = benchSizeReads(mediumFile, 10000);
  results.push(sizeResult);

  // --- Benchmark 4: OPFS read pattern ---
  const opfsOld = benchOpfsReadPatternOld(mediumFile, MEDIUM_SIZE, ITERATIONS);
  const opfsNew = benchOpfsReadPatternNew(mediumFile, MEDIUM_SIZE, ITERATIONS);
  results.push(opfsOld, opfsNew);
  comparisons.push({
    name: 'OPFS SyncAccessHandle.read() pattern (1000 iterations)',
    oldMs: opfsOld.totalMs,
    newMs: opfsNew.totalMs,
    speedup: `${((opfsOld.totalMs / opfsNew.totalMs - 1) * 100).toFixed(1)}% faster`,
  });

  // --- Benchmark 5: Stream read (1MB file) ---
  const streamOld = benchStreamReadOld(mediumFile, MEDIUM_SIZE);
  const streamNew = benchStreamReadNew(mediumFile, MEDIUM_SIZE);
  results.push(streamOld, streamNew);
  comparisons.push({
    name: `Stream read 1MB in 64KB chunks`,
    oldMs: streamOld.totalMs,
    newMs: streamNew.totalMs,
    speedup: `${((streamOld.totalMs / streamNew.totalMs - 1) * 100).toFixed(1)}% faster`,
  });

  // --- Benchmark 6: Stream read (10MB file) ---
  const streamLargeOld = benchStreamReadOld(largeFile, LARGE_SIZE);
  const streamLargeNew = benchStreamReadNew(largeFile, LARGE_SIZE);
  results.push(streamLargeOld, streamLargeNew);
  comparisons.push({
    name: `Stream read 10MB in 64KB chunks`,
    oldMs: streamLargeOld.totalMs,
    newMs: streamLargeNew.totalMs,
    speedup: `${((streamLargeOld.totalMs / streamLargeNew.totalMs - 1) * 100).toFixed(1)}% faster`,
  });

  // Cleanup
  if (benchDir.exists) {
    benchDir.delete();
  }

  // Generate summary
  let summary = '=== expo-file-system Performance Benchmark Results ===\n\n';

  summary += 'Individual Results:\n';
  for (const r of results) {
    summary += `  ${r.name}\n`;
    summary += `    Total: ${formatMs(r.totalMs)} | Avg: ${formatMs(r.avgMs)} | ${r.opsPerSec.toFixed(0)} ops/sec\n`;
  }

  summary += '\nComparisons (old vs new):\n';
  for (const c of comparisons) {
    summary += `  ${c.name}\n`;
    summary += `    Old: ${formatMs(c.oldMs)} → New: ${formatMs(c.newMs)} | ${c.speedup}\n`;
  }

  summary +=
    '\nNote: Actual speedup depends on device, OS, and filesystem.\n' +
    'The primary optimization is reducing JSI bridge crossings and syscalls,\n' +
    'which has a fixed per-call overhead that becomes significant at scale.\n';

  return { results, comparisons, summary };
}
