package expo.modules.filesystem

import android.content.ContentResolver
import android.net.Uri
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.sharedobjects.SharedRef
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.channels.FileChannel

enum class FileMode(val descriptor: String) : Record {
  /** Read-only */
  READ("r"),

  /** Write-only */
  WRITE("w"),

  /** Write-only. Appends to the end. */
  APPEND("wa"),

  /** Write-only. Wipes file contents before writing. */
  TRUNCATE("wt"),

  /** Read & write. */
  READ_WRITE("rw");

  /**
   * Mode value for [RandomAccessFile] constructor.
   *
   * **Note**: [RandomAccessFile] constructor supports only `"r"` and `"rw"`.
   * Other modes like `"wa"` or `"wt"` need to be handled manually.
   */
  val rafMode: String
    get() = if (this == READ) "r" else "rw"

  fun ensureCanRead() = when (this) {
    READ, READ_WRITE -> {}
    WRITE, APPEND, TRUNCATE -> throw Exceptions.IllegalStateException("Cannot read. File opened in write-only mode.")
  }

  fun ensureCanWrite() = when (this) {
    WRITE, READ_WRITE, APPEND, TRUNCATE -> {}
    READ -> throw Exceptions.IllegalStateException("Cannot write. File opened in read-only mode.")
  }
}

class FileSystemFileHandle private constructor(
  channel: FileChannel,
  private val mode: FileMode
) : SharedRef<FileChannel>(channel), AutoCloseable {
  companion object {
    fun forJavaFile(file: File, mode: FileMode): FileSystemFileHandle {
      val channel = RandomAccessFile(file, mode.rafMode).channel

      when (mode) {
        FileMode.APPEND -> {
          // RandomAccessFile does not handle append mode; move cursor manually
          channel.position(channel.size())
        }
        FileMode.TRUNCATE -> {
          // RandomAccessFile does not handle truncate mode; wipe content manually
          channel.truncate(0)
        }
        else -> {}
      }
      return FileSystemFileHandle(channel, mode)
    }

    fun forContentURI(uri: Uri, mode: FileMode, contentResolver: ContentResolver): FileSystemFileHandle {
      val pfd = contentResolver.openFileDescriptor(uri, mode.descriptor)
        ?: throw Exceptions.IllegalStateException("Could not open file descriptor for uri: $uri")

      val channel = when (mode) {
        FileMode.READ -> FileInputStream(pfd.fileDescriptor).channel
        FileMode.WRITE, FileMode.APPEND, FileMode.TRUNCATE -> FileOutputStream(pfd.fileDescriptor).channel
        else -> throw Exceptions.IllegalArgument("Unsupported file mode: '$mode'")
      }

      return FileSystemFileHandle(channel, mode)
    }
  }

  private val fileChannel: FileChannel = ref

  // Cache the file size to avoid repeated syscalls.
  // Updated on writes so size reads are free.
  private var cachedFileSize: Long = try { fileChannel.size() } catch (_: Exception) { 0L }

  private fun ensureIsOpen() {
    if (!fileChannel.isOpen) {
      throw UnableToReadHandleException("file handle is closed")
    }
  }

  override fun sharedObjectDidRelease() {
    close()
  }

  override fun close() {
    fileChannel.close()
  }

  fun read(length: Long): ByteArray {
    ensureIsOpen()
    mode.ensureCanRead()

    try {
      // Clamp the requested read length to a sane maximum without
      // extra position()/size() syscalls. FileChannel.read() naturally
      // returns fewer bytes (or -1) at EOF.
      val readAmount = length.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
      if (readAmount <= 0) {
        return ByteArray(0)
      }

      val buffer = ByteBuffer.allocate(readAmount)
      var bytesRead = 0
      while (bytesRead < readAmount) {
        val result = fileChannel.read(buffer)
        if (result == -1) break
        bytesRead += result
      }

      return if (bytesRead == readAmount) {
        buffer.array()
      } else {
        buffer.array().copyOfRange(0, bytesRead)
      }
    } catch (e: Exception) {
      throw UnableToReadHandleException(e.message ?: "unknown error")
    }
  }

  fun readAt(readOffset: Long, length: Long): ByteArray {
    fileChannel.position(readOffset)
    return read(length)
  }

  fun write(data: ByteArray) {
    ensureIsOpen()
    mode.ensureCanWrite()

    try {
      val positionBefore = fileChannel.position()
      val buffer = ByteBuffer.wrap(data)
      while (buffer.hasRemaining()) {
        fileChannel.write(buffer)
      }
      val newPosition = positionBefore + data.size
      if (newPosition > cachedFileSize) {
        cachedFileSize = newPosition
      }
    } catch (e: Exception) {
      throw UnableToWriteHandleException(e.message ?: "unknown error")
    }
  }

  fun writeAt(writeOffset: Long, data: ByteArray) {
    fileChannel.position(writeOffset)
    write(data)
  }

  var offset: Long?
    get() {
      return try {
        fileChannel.position()
      } catch (e: Exception) {
        null
      }
    }
    set(value) {
      if (value == null) return
      fileChannel.position(value)
    }

  val size: Long?
    get() {
      return if (fileChannel.isOpen) cachedFileSize else null
    }
}
