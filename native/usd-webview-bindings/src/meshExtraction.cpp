#include "webviewCommon.h"

namespace usdwebview {

bool
_GetUvForFaceVertex(
    const VtArray<GfVec2f>& uvValues,
    const TfToken& interpolation,
    size_t faceVertexOffset,
    int pointIndex,
    GfVec2f* uv)
{
    if (interpolation == UsdGeomTokens->faceVarying &&
        faceVertexOffset < uvValues.size()) {
        *uv = uvValues[faceVertexOffset];
        return true;
    }

    if ((interpolation == UsdGeomTokens->vertex || interpolation == UsdGeomTokens->varying) &&
        pointIndex >= 0 &&
        static_cast<size_t>(pointIndex) < uvValues.size()) {
        *uv = uvValues[pointIndex];
        return true;
    }

    if (interpolation == UsdGeomTokens->constant && uvValues.size() == 1) {
        *uv = uvValues[0];
        return true;
    }

    return false;
}

// Read mesh points, converting half-precision (point3h[]) to float if needed.
VtArray<GfVec3f>
_GetMeshPointsAsFloat(const UsdGeomMesh& mesh, UsdTimeCode timeCode)
{
    VtValue val;
    if (!mesh.GetPointsAttr().Get(&val, timeCode)) {
        return {};
    }
    if (val.IsHolding<VtArray<GfVec3f>>()) {
        return val.UncheckedGet<VtArray<GfVec3f>>();
    }
    if (val.IsHolding<VtArray<GfVec3h>>()) {
        const VtArray<GfVec3h>& half3 = val.UncheckedGet<VtArray<GfVec3h>>();
        VtArray<GfVec3f> result(half3.size());
        for (size_t i = 0; i < half3.size(); ++i) {
            result[i] = GfVec3f(
                float(half3[i][0]), float(half3[i][1]), float(half3[i][2]));
        }
        return result;
    }
    return {};
}

bool
_ExtractMeshPayload(
    const UsdGeomMesh& mesh,
    MeshPayload* payload,
    UsdTimeCode timeCode,
    const UsdSkelCache* skelCache,
    const UsdSkelSkeleton& skel,
    UsdGeomXformCache* xformCache)
{
    VtArray<GfVec3f> usdPoints = _GetMeshPointsAsFloat(mesh, timeCode);
    VtArray<int> faceVertexCounts;
    VtArray<int> faceVertexIndices;

    if (usdPoints.empty() ||
        !mesh.GetFaceVertexCountsAttr().Get(&faceVertexCounts) ||
        !mesh.GetFaceVertexIndicesAttr().Get(&faceVertexIndices) ||
        faceVertexCounts.empty() ||
        faceVertexIndices.empty()) {
        return false;
    }

    if (skelCache && skel && xformCache) {
        const UsdPrim meshPrim = mesh.GetPrim();
        if (UsdSkelSkinningQuery skinningQuery = skelCache->GetSkinningQuery(meshPrim)) {
            if (UsdSkelSkeletonQuery skelQuery = skelCache->GetSkelQuery(skel)) {
                VtArray<GfMatrix4d> skinningTransforms;
                skelQuery.ComputeSkinningTransforms(&skinningTransforms, timeCode);
                if (!skelQuery.GetAnimQuery()) {
                    _ComputeInferredSkinningTransforms(
                        skelCache,
                        skel,
                        timeCode,
                        &skinningTransforms);
                }
                if (!skinningTransforms.empty()) {
                    VtArray<GfVec3f> skinnedPoints = usdPoints;
                    if (skinningQuery.ComputeSkinnedPoints(
                            skinningTransforms,
                            &skinnedPoints,
                            timeCode)) {
                            const GfMatrix4d skelLocalToWorld =
                                xformCache->GetLocalToWorldTransform(skel.GetPrim());
                            const GfMatrix4d gprimLocalToWorld =
                                xformCache->GetLocalToWorldTransform(meshPrim);
                            const GfMatrix4d skelToGprim =
                                skelLocalToWorld * gprimLocalToWorld.GetInverse();
                            for (GfVec3f& point : skinnedPoints) {
                                point = GfVec3f(skelToGprim.Transform(point));
                            }
                            usdPoints = skinnedPoints;
                    }
                }
            }
        }
    }

    VtArray<GfVec2f> uvValues;
    TfToken uvInterpolation;
    UsdGeomPrimvar stPrimvar = UsdGeomPrimvarsAPI(mesh).GetPrimvar(TfToken("st"));
    const bool hasUvValues =
        stPrimvar &&
        stPrimvar.ComputeFlattened(&uvValues) &&
        !uvValues.empty();

    if (hasUvValues) {
        uvInterpolation = stPrimvar.GetInterpolation();
    }

    payload->points.reserve(faceVertexIndices.size() * 3);
    payload->triangleIndices.reserve(faceVertexIndices.size());
    if (hasUvValues) {
        payload->uvs.reserve(faceVertexIndices.size() * 2);
    }

    auto appendVertex = [&](size_t faceVertexOffset) {
        const int pointIndex = faceVertexIndices[faceVertexOffset];
        const GfVec3f& point = usdPoints[pointIndex];
        payload->points.push_back(point[0]);
        payload->points.push_back(point[1]);
        payload->points.push_back(point[2]);

        GfVec2f uv(0.0f, 0.0f);
        if (hasUvValues &&
            _GetUvForFaceVertex(uvValues, uvInterpolation, faceVertexOffset, pointIndex, &uv)) {
            payload->uvs.push_back(uv[0]);
            payload->uvs.push_back(uv[1]);
        }

        const int vertexIndex = static_cast<int>((payload->points.size() / 3) - 1);
        payload->triangleIndices.push_back(vertexIndex);
    };

    size_t offset = 0;
    payload->faceIndexStarts.reserve(faceVertexCounts.size());
    payload->faceIndexCounts.reserve(faceVertexCounts.size());
    for (int faceVertexCount : faceVertexCounts) {
        const int faceStart = static_cast<int>(payload->triangleIndices.size());
        if (faceVertexCount < 3 ||
            offset + static_cast<size_t>(faceVertexCount) > faceVertexIndices.size()) {
            offset += std::max(faceVertexCount, 0);
            payload->faceIndexStarts.push_back(faceStart);
            payload->faceIndexCounts.push_back(0);
            continue;
        }

        for (int i = 1; i < faceVertexCount - 1; ++i) {
            const int firstIndex = faceVertexIndices[offset];
            const int secondIndex = faceVertexIndices[offset + i];
            const int thirdIndex = faceVertexIndices[offset + i + 1];
            if (firstIndex < 0 || secondIndex < 0 || thirdIndex < 0 ||
                static_cast<size_t>(firstIndex) >= usdPoints.size() ||
                static_cast<size_t>(secondIndex) >= usdPoints.size() ||
                static_cast<size_t>(thirdIndex) >= usdPoints.size()) {
                continue;
            }

            appendVertex(offset);
            appendVertex(offset + i);
            appendVertex(offset + i + 1);
        }

        payload->faceIndexStarts.push_back(faceStart);
        payload->faceIndexCounts.push_back(
            static_cast<int>(payload->triangleIndices.size()) - faceStart);
        offset += faceVertexCount;
    }

    if (payload->uvs.size() != (payload->points.size() / 3) * 2) {
        payload->uvs.clear();
    }

    return !payload->triangleIndices.empty();
}

} // namespace usdwebview
