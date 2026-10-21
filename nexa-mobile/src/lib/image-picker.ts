/**
 * 相册选图 + 压缩（会话发消息 / 新建任务共用）
 *
 * 手机原图常 3-5MB，base64 后远超中继 4MB 单消息上限，
 * 因此统一压缩到长边 1600 / JPEG 0.7 再随消息上传。
 */
import * as ImagePicker from "expo-image-picker"
import * as ImageManipulator from "expo-image-manipulator"
import type { ImageAttachmentInput } from "./relay/protocol"

/** 待发送图片：上传字段 + 本地预览地址 */
export interface PickedImage extends ImageAttachmentInput {
  previewUri: string
}

/**
 * 打开相册（多选，最多 3 张）并压缩。
 * 用户取消返回 null；单张处理失败自动跳过。
 */
export async function pickAndCompressImages(): Promise<PickedImage[] | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: 3,
    quality: 1,
  })
  if (result.canceled) return null
  const out: PickedImage[] = []
  for (const asset of result.assets.slice(0, 3)) {
    const actions: ImageManipulator.Action[] = []
    const longEdge = Math.max(asset.width ?? 0, asset.height ?? 0)
    if (longEdge > 1600) {
      actions.push({ resize: (asset.width ?? 0) >= (asset.height ?? 0) ? { width: 1600 } : { height: 1600 } })
    }
    const manipulated = await ImageManipulator.manipulateAsync(asset.uri, actions, {
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    })
    if (!manipulated.base64) continue
    out.push({
      name: asset.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: "image/jpeg",
      dataUrl: `data:image/jpeg;base64,${manipulated.base64}`,
      previewUri: manipulated.uri,
    })
  }
  return out
}
