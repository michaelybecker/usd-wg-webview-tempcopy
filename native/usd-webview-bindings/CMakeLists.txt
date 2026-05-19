cmake_minimum_required(VERSION 3.20)

project(usdWebViewBindings LANGUAGES CXX)

find_package(pxr REQUIRED CONFIG)

set(USD_WEBVIEW_OPENUSD_SOURCE_DIR "/Users/michaelbecker/dev/USD/OpenUSD"
    CACHE PATH "OpenUSD source checkout used for private headers not installed by the WASM SDK")

if(TARGET TBB::tbb)
    get_target_property(_usd_webview_tbb_location TBB::tbb IMPORTED_LOCATION)
    if(NOT _usd_webview_tbb_location)
        set_target_properties(TBB::tbb PROPERTIES
            IMPORTED_LOCATION "${pxr_DIR}/lib/libtbb.a"
            INTERFACE_INCLUDE_DIRECTORIES "${pxr_DIR}/include"
        )
    endif()
endif()

add_executable(usdWebViewBindingsModule
    main.cpp
)

target_compile_features(usdWebViewBindingsModule PRIVATE cxx_std_17)
target_compile_options(usdWebViewBindingsModule PRIVATE -fPIC)
target_include_directories(usdWebViewBindingsModule PRIVATE ${USD_WEBVIEW_OPENUSD_SOURCE_DIR})

target_link_options(usdWebViewBindingsModule PRIVATE
    --bind
    --no-entry
    -O2
    "SHELL:-sMODULARIZE=1"
    "SHELL:-sEXPORT_ES6=1"
    "SHELL:-sEXPORT_NAME=createUsdWebViewBindingsModule"
    "SHELL:-sENVIRONMENT=web,worker"
    "SHELL:-sALLOW_MEMORY_GROWTH=1"
    "SHELL:-sFORCE_FILESYSTEM=1"
    "SHELL:-sEXPORTED_RUNTIME_METHODS=['FS_createPath','FS_createDataFile','FS_analyzePath','FS_unlink']"
    "SHELL:--embed-file ${pxr_DIR}/lib/usd@/usd"
    "SHELL:-Wl,--whole-archive ${pxr_DIR}/lib/libusd_usdImaging.a ${pxr_DIR}/lib/libusd_usdSkelImaging.a -Wl,--no-whole-archive"
)

target_link_libraries(usdWebViewBindingsModule
    PRIVATE
        usdSkelImaging
        usdImaging
        usdVolImaging
        usdProcImaging
        usdHydra
        hdsi
        hdGp
        hdar
        hd
        hgi
        hio
        pxOsd
        cameraUtil
        sdrGlslfx
        sdr
        usdGeom
        usdShade
        usdSkel
        usdLux
        usdRender
        usdUtils
        usd
        sdf
        pcp
        plug
        vt
        gf
        work
        ar
        tf
        arch
)

install(
    FILES
        ${CMAKE_CURRENT_BINARY_DIR}/usdWebViewBindingsModule.js
        ${CMAKE_CURRENT_BINARY_DIR}/usdWebViewBindingsModule.wasm
    DESTINATION
        .
)
