#include "webviewCommon.h"

namespace usdwebview {

SdfPrimSpecHandle
_EnsurePrimSpecInLayer(const SdfLayerHandle& layer, const SdfPath& primPath)
{
    if (!layer || !primPath.IsAbsolutePath() || !primPath.IsPrimPath()) {
        return SdfPrimSpecHandle();
    }

    SdfChangeBlock changeBlock;
    SdfPrimSpecHandle primSpec = layer->GetPseudoRoot();
    for (const SdfPath& prefix : primPath.GetPrefixes()) {
        if (prefix == SdfPath::AbsoluteRootPath()) {
            continue;
        }
        if (!primSpec) {
            return SdfPrimSpecHandle();
        }

        SdfPrimSpecHandle childSpec = layer->GetPrimAtPath(prefix);
        const std::string name = prefix.GetName();
        if (!childSpec) {
            for (const SdfPrimSpecHandle& child : primSpec->GetNameChildren()) {
                if (child && child->GetName() == name) {
                    childSpec = child;
                    break;
                }
            }
        }
        if (!childSpec) {
            childSpec = SdfPrimSpec::New(
                primSpec,
                name,
                SdfSpecifierOver,
                std::string());
        }
        primSpec = childSpec;
    }
    return primSpec;
}

SdfRelationshipSpecHandle
_EnsureRelationshipSpecInLayer(
    const SdfLayerHandle& layer,
    const SdfPath& primPath,
    const TfToken& relationshipName,
    LegacySkelBindingAuthoringDiagnostics* diagnostics)
{
    SdfPrimSpecHandle primSpec = _EnsurePrimSpecInLayer(layer, primPath);
    if (!primSpec) {
        return SdfRelationshipSpecHandle();
    }

    const SdfPath relationshipPath =
        primPath.AppendProperty(relationshipName);
    if (diagnostics) {
        ++diagnostics->relationshipCreateAttempts;
    }
    SdfRelationshipSpecHandle relSpec =
        layer->GetRelationshipAtPath(relationshipPath);
    if (!relSpec) {
        relSpec = SdfRelationshipSpec::New(
            primSpec,
            relationshipName.GetString(),
            /* custom = */ false,
            SdfVariabilityUniform);
    }
    if (!relSpec && diagnostics) {
        ++diagnostics->relationshipCreateFailures;
        if (diagnostics->firstRelationshipFailurePath.empty()) {
            diagnostics->firstRelationshipFailurePath =
                relationshipPath.GetString();
        }
    }
    return relSpec;
}

UsdPrim
_FindFirstDescendantOfType(const UsdPrim& root, const TfToken& typeName)
{
    if (!root) {
        return UsdPrim();
    }

    for (const UsdPrim& prim : UsdPrimRange(root)) {
        if (prim == root) {
            continue;
        }
        if (prim.GetTypeName() == typeName) {
            return prim;
        }
    }
    return UsdPrim();
}

UsdPrim
_InferSkeletonForSkelBoundPrim(const UsdPrim& prim)
{
    if (!prim) {
        return UsdPrim();
    }

    static const TfToken kSkeletonType("Skeleton");
    for (UsdPrim ancestor = prim.GetParent();
         ancestor && !ancestor.IsPseudoRoot();
         ancestor = ancestor.GetParent()) {
        UsdPrim skeleton = _FindFirstDescendantOfType(ancestor, kSkeletonType);
        if (skeleton) {
            return skeleton;
        }
    }
    return UsdPrim();
}

UsdPrim
_InferAnimationForSkeleton(const UsdPrim& skeleton)
{
    static const TfToken kSkelAnimationType("SkelAnimation");
    return _FindFirstDescendantOfType(skeleton, kSkelAnimationType);
}

bool
_ComputeInferredSkinningTransforms(
    const UsdSkelCache* skelCache,
    const UsdSkelSkeleton& skeleton,
    UsdTimeCode timeCode,
    VtArray<GfMatrix4d>* skinningTransforms,
    emscripten::val* debugInfo)
{
    if (!skelCache || !skeleton || !skinningTransforms) {
        return false;
    }

    UsdPrim animationPrim = _InferAnimationForSkeleton(skeleton.GetPrim());
    if (debugInfo) {
        debugInfo->set("inferredAnimationPrimPath", animationPrim
            ? animationPrim.GetPath().GetString()
            : std::string());
    }
    if (!animationPrim) {
        return false;
    }

    UsdSkelSkeletonQuery skelQuery = skelCache->GetSkelQuery(skeleton);
    UsdSkelAnimQuery animQuery =
        skelCache->GetAnimQuery(UsdSkelAnimation(animationPrim));
    if (!skelQuery || !animQuery) {
        return false;
    }

    VtArray<GfMatrix4d> animLocalTransforms;
    VtTokenArray animJointOrder;
    bool animQueryComputed = false;
    if (animQuery &&
        animQuery.ComputeJointLocalTransforms(&animLocalTransforms, timeCode) &&
        !animLocalTransforms.empty()) {
        animJointOrder = animQuery.GetJointOrder();
        animQueryComputed = true;
    } else {
        UsdSkelAnimation animation(animationPrim);
        VtArray<GfVec3f> translations;
        VtArray<GfQuatf> rotations;
        VtArray<GfVec3h> scales;
        animation.GetJointsAttr().Get(&animJointOrder);
        animation.GetTranslationsAttr().Get(&translations, timeCode);
        animation.GetRotationsAttr().Get(&rotations, timeCode);
        animation.GetScalesAttr().Get(&scales, timeCode);

        size_t transformCount = animJointOrder.size();
        transformCount = std::max(transformCount, translations.size());
        transformCount = std::max(transformCount, rotations.size());
        transformCount = std::max(transformCount, scales.size());
        if (debugInfo) {
            debugInfo->set("rawAnimJointCount", static_cast<int>(animJointOrder.size()));
            debugInfo->set("rawTranslationCount", static_cast<int>(translations.size()));
            debugInfo->set("rawRotationCount", static_cast<int>(rotations.size()));
            debugInfo->set("rawScaleCount", static_cast<int>(scales.size()));
            debugInfo->set("rawTransformCount", static_cast<int>(transformCount));
        }
        if (transformCount == 0) {
            return false;
        }

        if (translations.size() != transformCount) {
            translations.assign(transformCount, GfVec3f(0.0f));
        }
        if (rotations.size() != transformCount) {
            rotations.assign(transformCount, GfQuatf(1.0f));
        }
        if (scales.size() != transformCount) {
            scales.assign(transformCount, GfVec3h(1.0f));
        }
        if (animJointOrder.empty()) {
            animJointOrder = skelQuery.GetJointOrder();
        }

        animLocalTransforms.resize(translations.size());
        if (!UsdSkelMakeTransforms(
                translations,
                rotations,
                scales,
                &animLocalTransforms)) {
            return false;
        }
    }
    if (debugInfo) {
        debugInfo->set("usedAnimQueryTransforms", animQueryComputed);
        debugInfo->set("animJointOrderCount", static_cast<int>(animJointOrder.size()));
        debugInfo->set("animLocalTransformCount", static_cast<int>(animLocalTransforms.size()));
    }

    if (animJointOrder.empty() || animLocalTransforms.empty()) {
        return false;
    }

    VtArray<GfMatrix4d> localTransforms;
    if (!skelQuery.ComputeJointLocalTransforms(&localTransforms, timeCode) ||
        localTransforms.empty()) {
        return false;
    }

    VtTokenArray skelJointOrder = skelQuery.GetJointOrder();
    if (skelJointOrder.empty() ||
        animJointOrder.empty() ||
        localTransforms.size() != skelJointOrder.size()) {
        if (debugInfo) {
            debugInfo->set("skelJointOrderCount", static_cast<int>(skelJointOrder.size()));
            debugInfo->set("seedLocalTransformCount", static_cast<int>(localTransforms.size()));
        }
        return false;
    }

    UsdSkelAnimMapper animToSkelMapper(animJointOrder, skelJointOrder);
    if (debugInfo) {
        debugInfo->set("inferredAnimMapperIsNull", animToSkelMapper.IsNull());
        debugInfo->set("inferredAnimMapperIsSparse", animToSkelMapper.IsSparse());
    }
    if (animToSkelMapper.IsNull()) {
        return false;
    }
    if (!animToSkelMapper.RemapTransforms(animLocalTransforms, &localTransforms)) {
        if (debugInfo) {
            debugInfo->set("inferredAnimMapperRemapFailed", true);
        }
        return false;
    }

    VtArray<GfMatrix4d> jointSkelTransforms;
    jointSkelTransforms.resize(localTransforms.size());
    if (!UsdSkelConcatJointTransforms(
            skelQuery.GetTopology(),
            localTransforms,
            jointSkelTransforms)) {
        if (debugInfo) {
            debugInfo->set("concatFailed", true);
            debugInfo->set("localTransformCount", static_cast<int>(localTransforms.size()));
        }
        return false;
    }

    VtArray<GfMatrix4d> bindTransforms;
    if (!skelQuery.GetJointWorldBindTransforms(&bindTransforms) ||
        bindTransforms.size() != jointSkelTransforms.size()) {
        if (debugInfo) {
            debugInfo->set("bindTransformCount", static_cast<int>(bindTransforms.size()));
            debugInfo->set("jointSkelTransformCount", static_cast<int>(jointSkelTransforms.size()));
        }
        return false;
    }

    skinningTransforms->resize(jointSkelTransforms.size());
    for (size_t index = 0; index < jointSkelTransforms.size(); ++index) {
        (*skinningTransforms)[index] =
            bindTransforms[index].GetInverse() * jointSkelTransforms[index];
    }
    return true;
}

int
_AuthorInferredSkelBindingTargetsToLayer(
    const UsdStageRefPtr& sourceStage,
    const SdfLayerHandle& targetLayer,
    LegacySkelBindingAuthoringDiagnostics* diagnostics)
{
    if (!sourceStage || !targetLayer) {
        return 0;
    }
    if (diagnostics) {
        diagnostics->sessionLayerIdentifier = targetLayer->GetIdentifier();
    }

    UsdSkelCache skinningQueryCache;
    for (const UsdPrim& prim : UsdPrimRange(sourceStage->GetPseudoRoot())) {
        if (prim.IsA<UsdSkelRoot>()) {
            skinningQueryCache.Populate(
                UsdSkelRoot(prim),
                UsdTraverseInstanceProxies());
        }
    }

    int authoredCount = 0;
    static const TfToken kSkeletonType("Skeleton");
    for (const UsdPrim& prim : UsdPrimRange(sourceStage->GetPseudoRoot())) {
        if (prim.GetTypeName() == kSkeletonType) {
            if (diagnostics) {
                ++diagnostics->skeletonPrims;
            }

            UsdPrim animation = _InferAnimationForSkeleton(prim);
            if (!animation) {
                continue;
            }
            if (diagnostics) {
                ++diagnostics->animationTargets;
            }

            SdfRelationshipSpecHandle relSpec =
                _EnsureRelationshipSpecInLayer(
                    targetLayer,
                    prim.GetPath(),
                    UsdSkelTokens->skelAnimationSource,
                    diagnostics);
            if (relSpec) {
                relSpec->GetTargetPathList().Prepend(animation.GetPath());
                ++authoredCount;
                if (diagnostics) {
                    ++diagnostics->relationshipSpecs;
                }
            }
            continue;
        }

        if (!prim.IsA<UsdGeomMesh>()) {
            continue;
        }
        if (diagnostics) {
            ++diagnostics->meshPrims;
        }
        if (!skinningQueryCache.GetSkinningQuery(prim)) {
            continue;
        }
        if (diagnostics) {
            ++diagnostics->meshSkinningQueries;
        }

        UsdPrim skeleton = _InferSkeletonForSkelBoundPrim(prim);
        if (!skeleton) {
            continue;
        }
        if (diagnostics) {
            ++diagnostics->meshInferredSkeletons;
        }

        SdfRelationshipSpecHandle relSpec =
            _EnsureRelationshipSpecInLayer(
                targetLayer,
                prim.GetPath(),
                UsdSkelTokens->skelSkeleton,
                diagnostics);
        if (relSpec) {
            relSpec->GetTargetPathList().Prepend(skeleton.GetPath());
            ++authoredCount;
            if (diagnostics) {
                ++diagnostics->relationshipSpecs;
            }
        }
    }

    return authoredCount;
}

} // namespace usdwebview
