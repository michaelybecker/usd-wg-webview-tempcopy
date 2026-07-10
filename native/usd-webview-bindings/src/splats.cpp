#include "webviewCommon.h"

namespace usdwebview {

emscripten::val
ExtractGaussianSplats(const std::string& path)
{
    emscripten::val result = emscripten::val::array();
    UsdStageRefPtr stage = _GetOrOpenStage(path);
    if (!stage) return result;

    UsdGeomXformCache xformCache(stage->GetStartTimeCode());
    size_t splatIndex = 0;

    static const TfToken kType("ParticleField3DGaussianSplat");
    static const TfToken kPositions("positions");
    static const TfToken kPositionsH("positionsh");
    static const TfToken kScales("scales");
    static const TfToken kScalesH("scalesh");
    static const TfToken kOrientations("orientations");
    static const TfToken kOrientationsH("orientationsh");
    static const TfToken kOpacities("opacities");
    static const TfToken kOpacitiesH("opacitiesh");
    static const TfToken kSHCoeffs("radiance:sphericalHarmonicsCoefficients");
    static const TfToken kSHDegree("radiance:sphericalHarmonicsDegree");

    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        if (prim.GetTypeName() != kType) {
            continue;
        }

        // --- Positions ---
        std::vector<float> posOut;
        {
            VtArray<GfVec3f> arr;
            if (prim.GetAttribute(kPositions).Get(&arr) && !arr.empty()) {
                posOut.reserve(arr.size() * 3);
                for (const auto& v : arr) {
                    posOut.push_back(v[0]);
                    posOut.push_back(v[1]);
                    posOut.push_back(v[2]);
                }
            } else {
                VtArray<GfVec3h> arrh;
                if (prim.GetAttribute(kPositionsH).Get(&arrh) && !arrh.empty()) {
                    posOut.reserve(arrh.size() * 3);
                    for (const auto& v : arrh) {
                        posOut.push_back(static_cast<float>(v[0]));
                        posOut.push_back(static_cast<float>(v[1]));
                        posOut.push_back(static_cast<float>(v[2]));
                    }
                }
            }
        }
        if (posOut.empty()) continue;
        const size_t count = posOut.size() / 3;

        // --- Scales ---
        std::vector<float> scaleOut;
        {
            VtArray<GfVec3f> arr;
            if (prim.GetAttribute(kScales).Get(&arr) && !arr.empty()) {
                scaleOut.reserve(arr.size() * 3);
                for (const auto& v : arr) {
                    scaleOut.push_back(v[0]);
                    scaleOut.push_back(v[1]);
                    scaleOut.push_back(v[2]);
                }
            } else {
                VtArray<GfVec3h> arrh;
                if (prim.GetAttribute(kScalesH).Get(&arrh) && !arrh.empty()) {
                    scaleOut.reserve(arrh.size() * 3);
                    for (const auto& v : arrh) {
                        scaleOut.push_back(static_cast<float>(v[0]));
                        scaleOut.push_back(static_cast<float>(v[1]));
                        scaleOut.push_back(static_cast<float>(v[2]));
                    }
                }
            }
        }

        // --- Orientations → [x, y, z, w] per splat ---
        std::vector<float> orientOut;
        {
            VtArray<GfQuatf> arr;
            if (prim.GetAttribute(kOrientations).Get(&arr) && !arr.empty()) {
                orientOut.reserve(arr.size() * 4);
                for (const auto& q : arr) {
                    orientOut.push_back(q.GetImaginary()[0]);
                    orientOut.push_back(q.GetImaginary()[1]);
                    orientOut.push_back(q.GetImaginary()[2]);
                    orientOut.push_back(q.GetReal());
                }
            } else {
                VtArray<GfQuath> arrh;
                if (prim.GetAttribute(kOrientationsH).Get(&arrh) && !arrh.empty()) {
                    orientOut.reserve(arrh.size() * 4);
                    for (const auto& q : arrh) {
                        orientOut.push_back(static_cast<float>(q.GetImaginary()[0]));
                        orientOut.push_back(static_cast<float>(q.GetImaginary()[1]));
                        orientOut.push_back(static_cast<float>(q.GetImaginary()[2]));
                        orientOut.push_back(static_cast<float>(q.GetReal()));
                    }
                }
            }
        }

        // --- Opacities ---
        std::vector<float> opacOut;
        {
            VtArray<float> arr;
            if (prim.GetAttribute(kOpacities).Get(&arr) && !arr.empty()) {
                opacOut.assign(arr.begin(), arr.end());
            } else {
                VtArray<GfHalf> arrh;
                if (prim.GetAttribute(kOpacitiesH).Get(&arrh) && !arrh.empty()) {
                    opacOut.reserve(arrh.size());
                    for (const auto& h : arrh) {
                        opacOut.push_back(static_cast<float>(h));
                    }
                }
            }
        }

        // --- SH Coefficients (all degrees, stored as count*coeffsPerSplat vec3fs) ---
        std::vector<float> shOut;
        int shDegree = 0;
        {
            VtArray<GfVec3f> arr;
            if (prim.GetAttribute(kSHCoeffs).Get(&arr) && !arr.empty()) {
                shOut.reserve(arr.size() * 3);
                for (const auto& v : arr) {
                    shOut.push_back(v[0]);
                    shOut.push_back(v[1]);
                    shOut.push_back(v[2]);
                }
                // Infer degree from total coefficient count
                const size_t coeffsPerSplat = arr.size() / count;
                for (int d = 0; d <= 3; ++d) {
                    if (static_cast<size_t>((d + 1) * (d + 1)) == coeffsPerSplat) {
                        shDegree = d;
                        break;
                    }
                }
            }
            // Authored degree overrides inferred one
            int authoredDegree = 0;
            if (prim.GetAttribute(kSHDegree).Get(&authoredDegree)) {
                shDegree = authoredDegree;
            }
        }

        emscripten::val entry = emscripten::val::object();
        entry.set("path", prim.GetPath().GetString());
        entry.set("name", prim.GetName().GetString());
        entry.set("count", static_cast<int>(count));
        entry.set("matrix", _MatrixArray(xformCache.GetLocalToWorldTransform(prim)));
        entry.set("positions", _Float32Array(posOut));
        entry.set("scales", _Float32Array(scaleOut));
        entry.set("orientations", _Float32Array(orientOut));
        entry.set("opacities", _Float32Array(opacOut));
        if (!shOut.empty()) {
            entry.set("shCoeffs", _Float32Array(shOut));
            entry.set("shDegree", shDegree);
        }
        result.set(splatIndex++, entry);
    }

    return result;
}

} // namespace usdwebview
