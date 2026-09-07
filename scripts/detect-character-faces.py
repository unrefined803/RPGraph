"""Local image-only face detection. JSON in/out; no app, camera, or network access."""
import base64
import json
import sys


def face_crop(box, width, height, padding=1.55):
    """Store a square's top-left coordinates and diameter in gallery percentages."""
    side = min(width, height, max(box.width, box.height) * padding)
    x = max(0, min(width - side, box.origin_x + box.width / 2 - side / 2))
    y = max(0, min(height - side, box.origin_y + box.height / 2 - side / 2))
    return {"x": round(x / width * 100, 6), "y": round(y / height * 100, 6),
            "size": round(side / width * 100, 6)}


def main():
    import cv2
    import mediapipe as mp
    import numpy as np
    request = json.load(sys.stdin)
    options = mp.tasks.vision.FaceDetectorOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=sys.argv[1]),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        min_detection_confidence=0.85)
    results = []
    with mp.tasks.vision.FaceDetector.create_from_options(options) as detector:
        for image in request:
            pixels = cv2.imdecode(np.frombuffer(base64.b64decode(image["dataUrl"].split(",", 1)[1]),
                                               dtype=np.uint8), cv2.IMREAD_COLOR)
            if pixels is None:
                raise ValueError(f'Cannot decode portrait: {image["id"]}')
            height, width = pixels.shape[:2]
            rgb = cv2.cvtColor(pixels, cv2.COLOR_BGR2RGB)
            detections = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)).detections
            result = {"id": image["id"], "faces": len(detections), "width": width, "height": height}
            if len(detections) == 1:
                result["crop"] = face_crop(detections[0].bounding_box, width, height)
                result["confidence"] = detections[0].categories[0].score
            results.append(result)
    json.dump(results, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Face detection failed: {error}", file=sys.stderr)
        sys.exit(1)
